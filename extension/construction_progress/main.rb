require 'sketchup.rb'
require 'json'

module ConstructionProgress
  DICT_NAME = 'ConstructionProgress'

  # Natural key attribute names — stable across DB reseeds and model copies
  KEY_FLOOR  = 'cp_floor'
  KEY_ZONE   = 'cp_zone_room'
  KEY_JOB    = 'cp_job_type'
  KEY_DEFECT = 'cp_defect_code'  # stores full number_code string for defect components

  # Composite key format used to match SketchUp entities to DB tasks
  def self.task_key(floor, zone, job)
    "#{floor}||#{zone}||#{job}"
  end

  def self.zone_key(floor, zone)
    "#{floor}||#{zone}"
  end

  # ── Migration ──────────────────────────────────────────────────────────────
  # Convert existing entities that still use old UUID attributes to natural keys.
  # Parses the entity name which was set during assignment:
  #   Group:     "Zone Name (FLOOR)"
  #   Component: "Job Type (Zone Name - FLOOR)"
  def self.migrate_legacy_attributes
    model = Sketchup.active_model
    migrated = 0

    model.entities.each do |ent|
      if ent.is_a?(Sketchup::Group)
        # Skip if already on natural keys
        next if ent.get_attribute(DICT_NAME, KEY_FLOOR)

        # Has legacy UUID attribute?
        next unless ent.get_attribute(DICT_NAME, 'location_id')

        # Parse name: "Zone Name (FLOOR)"
        if ent.name =~ /^(.+)\s+\(([^)]+)\)$/
          zone_room = $1.strip
          floor     = $2.strip
          ent.set_attribute(DICT_NAME, KEY_FLOOR, floor)
          ent.set_attribute(DICT_NAME, KEY_ZONE, zone_room)
          ent.delete_attribute(DICT_NAME, 'location_id')
          migrated += 1
        end

        # Migrate child components
        ent.entities.each do |child|
          next unless child.is_a?(Sketchup::ComponentInstance)
          next if child.get_attribute(DICT_NAME, KEY_JOB)
          next unless child.get_attribute(DICT_NAME, 'task_id')

          # Parse name: "Job Type (Zone Name - FLOOR)"
          if child.name =~ /^(.+)\s+\((.+)\s+-\s+([^)]+)\)$/
            job_type  = $1.strip
            zone_room = $2.strip
            floor     = $3.strip
            child.set_attribute(DICT_NAME, KEY_FLOOR, floor)
            child.set_attribute(DICT_NAME, KEY_ZONE, zone_room)
            child.set_attribute(DICT_NAME, KEY_JOB, job_type)
            child.delete_attribute(DICT_NAME, 'task_id')
            child.delete_attribute(DICT_NAME, 'location_id')
            migrated += 1
          end
        end
      end
    end

    migrated
  end

  # ── Selection Observer ─────────────────────────────────────────────────────
  class InspectorObserver < Sketchup::SelectionObserver
    def initialize(dialog)
      @dialog = dialog
    end

    def onSelectionBulkChange(selection)
      update_dialog(selection)
    end

    def onSelectionCleared(selection)
      update_dialog(selection)
    end

    def update_dialog(selection)
      return unless @dialog && @dialog.visible?

      if selection.empty? || selection.count > 1
        @dialog.execute_script("window.updateSelection({ type: null })")
        return
      end

      entity = selection.first
      data = { type: nil }

      if entity.is_a?(Sketchup::Group)
        floor    = entity.get_attribute(DICT_NAME, KEY_FLOOR)
        zone     = entity.get_attribute(DICT_NAME, KEY_ZONE)
        mapped   = !floor.nil?

        # Collect natural keys of tasks already mapped inside this zone group
        mapped_task_keys = []
        if mapped
          entity.entities.each do |child|
            if child.is_a?(Sketchup::ComponentInstance) || child.is_a?(Sketchup::Group)
              c_floor = child.get_attribute(DICT_NAME, KEY_FLOOR)
              c_zone  = child.get_attribute(DICT_NAME, KEY_ZONE)
              c_job   = child.get_attribute(DICT_NAME, KEY_JOB)
              mapped_task_keys << ConstructionProgress.task_key(c_floor, c_zone, c_job) if c_floor && c_zone && c_job
            end
          end
        end

        data = {
          type: 'Group',
          mapped: mapped,
          cp_floor: floor,
          cp_zone_room: zone,
          mapped_task_keys: mapped_task_keys
        }

      elsif entity.is_a?(Sketchup::ComponentInstance)
        floor  = entity.get_attribute(DICT_NAME, KEY_FLOOR)
        zone   = entity.get_attribute(DICT_NAME, KEY_ZONE)
        job    = entity.get_attribute(DICT_NAME, KEY_JOB)
        defect = entity.get_attribute(DICT_NAME, KEY_DEFECT)

        # Parent zone natural keys (for auto-filtering task/defect lists)
        parent_floor = nil
        parent_zone  = nil
        active_path = Sketchup.active_model.active_path
        if active_path && active_path.last.is_a?(Sketchup::Group)
          parent_floor = active_path.last.get_attribute(DICT_NAME, KEY_FLOOR)
          parent_zone  = active_path.last.get_attribute(DICT_NAME, KEY_ZONE)
        end

        if defect
          # Mapped as Defect component
          data = {
            type: 'ComponentInstance',
            mapped: true,
            is_defect: true,
            cp_defect_code: defect,
            cp_floor: floor,
            cp_zone_room: zone,
            parent_floor: parent_floor,
            parent_zone_room: parent_zone
          }
        else
          data = {
            type: 'ComponentInstance',
            mapped: !floor.nil?,
            is_defect: false,
            cp_floor: floor,
            cp_zone_room: zone,
            cp_job_type: job,
            parent_floor: parent_floor,
            parent_zone_room: parent_zone
          }
        end
      end

      @dialog.execute_script("window.updateSelection(#{data.to_json})")
    end
  end

  # ── Dialog ─────────────────────────────────────────────────────────────────
  def self.show_inspector
    if @dialog && @dialog.visible?
      @dialog.bring_to_front
      return
    end

    # Discard any stale dialog reference so we always create fresh
    @dialog = nil

    # Migrate any legacy UUID-keyed entities before opening
    migrated = migrate_legacy_attributes
    puts "[ConstructionProgress] Migrated #{migrated} legacy entities to natural keys." if migrated > 0

    @dialog = UI::HtmlDialog.new(
      {
        :dialog_title    => "Construction Progress Inspector",
        :preferences_key => "com.antigravity.constructionprogress.inspector",
        :scrollable      => true,
        :resizable       => true,
        :width           => 450,
        :height          => 820,
        :style           => UI::HtmlDialog::STYLE_DIALOG
      }
    )

    html_path = File.join(__dir__, 'ui', 'inspector.html')
    @dialog.set_file(html_path)

    # ── Callbacks ──────────────────────────────────────────────────────────
    @dialog.add_action_callback("assignItem") do |_ctx, data|
      assign_item(data)
    end

    @dialog.add_action_callback("unassignItem") do |_ctx|
      unassign_item
    end

    @dialog.add_action_callback("assignDefect") do |_ctx, data|
      assign_defect(data)
    end

    @dialog.add_action_callback("unassignDefect") do |_ctx|
      unassign_defect
    end

    @dialog.add_action_callback("updateHeatmap") do |_ctx, data|
      update_heatmap(data)
    end

    @dialog.add_action_callback("redrawSelectedModel") do |_ctx, data|
      redraw_selected_model(data)
    end

    @dialog.add_action_callback("resizeDialog") do |_ctx, data|
      @dialog.set_size(data['width'].to_i, data['height'].to_i)
    end

    @dialog.add_action_callback("getAllMappedTasks") do |_ctx|
      keys = get_all_mapped_task_keys
      @dialog.execute_script("window.receiveMappedTasks(#{keys.to_json})")
    end

    @dialog.add_action_callback("filterModels") do |_ctx, data|
      filter_models(data['visible_task_keys'] || [])
    end

    @dialog.add_action_callback("unhideAll") do |_ctx|
      unhide_all_entities
    end

    @dialog.add_action_callback("zoomToTask") do |_ctx, data|
      zoom_to_task(data['task_key'])
    end

    @dialog.add_action_callback("zoomToDefect") do |_ctx, data|
      zoom_to_defect(data['number_code'])
    end

    @dialog.show

    # Attach observer
    observer = InspectorObserver.new(@dialog)
    Sketchup.active_model.selection.add_observer(observer)

    # Initial update
    observer.update_dialog(Sketchup.active_model.selection)
  end

  # ── Assign / Unassign ──────────────────────────────────────────────────────
  def self.assign_item(data)
    model  = Sketchup.active_model
    entity = model.selection.first
    return unless entity

    model.start_operation('Assign Construction Item', true)

    if data['type'] == 'Group'
      entity.set_attribute(DICT_NAME, KEY_FLOOR, data['floor'])
      entity.set_attribute(DICT_NAME, KEY_ZONE,  data['zone_room'])
      # Remove any old UUID attributes
      entity.delete_attribute(DICT_NAME, 'location_id')
    elsif data['type'] == 'ComponentInstance'
      entity.set_attribute(DICT_NAME, KEY_FLOOR, data['floor'])
      entity.set_attribute(DICT_NAME, KEY_ZONE,  data['zone_room'])
      entity.set_attribute(DICT_NAME, KEY_JOB,   data['job_type'])
      # Remove any old UUID attributes
      entity.delete_attribute(DICT_NAME, 'task_id')
      entity.delete_attribute(DICT_NAME, 'location_id')
    end

    entity.name = data['name'] if data['name']

    if data['tag']
      layers = model.layers
      layer  = layers[data['tag']] || layers.add(data['tag'])
      entity.layer = layer
    end

    model.commit_operation

    if @dialog && @dialog.visible?
      UI.start_timer(0.1, false) do
        Sketchup.active_model.selection.remove(entity)
        Sketchup.active_model.selection.add(entity)
      end
    end
  end

  def self.unassign_item
    model  = Sketchup.active_model
    entity = model.selection.first
    return unless entity

    model.start_operation('Unassign Construction Item', true)
    entity.delete_attribute(DICT_NAME)
    entity.name  = ""
    entity.layer = model.layers["Layer0"] || model.layers["Untagged"]
    model.commit_operation

    if @dialog && @dialog.visible?
      UI.start_timer(0.1, false) do
        Sketchup.active_model.selection.remove(entity)
        Sketchup.active_model.selection.add(entity)
      end
    end
  end

  # ── Defect Assign / Unassign ───────────────────────────────────────────────
  def self.assign_defect(data)
    model  = Sketchup.active_model
    entity = model.selection.first
    return unless entity && entity.is_a?(Sketchup::ComponentInstance)

    model.start_operation('Assign Defect', true)

    # Store zone keys for context + defect code as the identifier
    entity.set_attribute(DICT_NAME, KEY_FLOOR,  data['floor'])
    entity.set_attribute(DICT_NAME, KEY_ZONE,   data['zone_room'])
    entity.set_attribute(DICT_NAME, KEY_DEFECT, data['number_code'])
    # Clear any existing job attributes to avoid confusion
    entity.delete_attribute(DICT_NAME, KEY_JOB)

    # Set instance name to the number_code so it can be identified in the model browser
    entity.name = data['number_code'] if data['number_code']

    # Tag the component on a "Defect" layer/tag for visual filtering
    layers = model.layers
    layer  = layers['Defect'] || layers.add('Defect')
    entity.layer = layer

    model.commit_operation

    if @dialog && @dialog.visible?
      UI.start_timer(0.1, false) do
        Sketchup.active_model.selection.remove(entity)
        Sketchup.active_model.selection.add(entity)
      end
    end
  end

  def self.unassign_defect
    model  = Sketchup.active_model
    entity = model.selection.first
    return unless entity

    model.start_operation('Unassign Defect', true)
    entity.delete_attribute(DICT_NAME)
    entity.name  = ""
    entity.layer = model.layers["Layer0"] || model.layers["Untagged"]
    model.commit_operation

    if @dialog && @dialog.visible?
      UI.start_timer(0.1, false) do
        Sketchup.active_model.selection.remove(entity)
        Sketchup.active_model.selection.add(entity)
      end
    end
  end

  # ── Mapped Task Keys ───────────────────────────────────────────────────────
  # Returns composite natural keys for all mapped ComponentInstances
  def self.get_all_mapped_task_keys
    model = Sketchup.active_model
    keys  = []
    model.entities.each do |ent|
      # Check root-level components
      if ent.is_a?(Sketchup::ComponentInstance)
        f = ent.get_attribute(DICT_NAME, KEY_FLOOR)
        z = ent.get_attribute(DICT_NAME, KEY_ZONE)
        j = ent.get_attribute(DICT_NAME, KEY_JOB)
        keys << task_key(f, z, j) if f && z && j
      end
      # Check inside groups (zones)
      if ent.is_a?(Sketchup::Group)
        ent.entities.each do |child|
          if child.is_a?(Sketchup::ComponentInstance)
            f = child.get_attribute(DICT_NAME, KEY_FLOOR)
            z = child.get_attribute(DICT_NAME, KEY_ZONE)
            j = child.get_attribute(DICT_NAME, KEY_JOB)
            keys << task_key(f, z, j) if f && z && j
          end
        end
      end
    end
    keys.uniq
  end

  # ── Filter Models ──────────────────────────────────────────────────────────
  # visible_task_keys: array of "floor||zone_room||job_type" strings
  def self.filter_models(visible_task_keys)
    model = Sketchup.active_model
    model.start_operation('Filter Report Models', true)

    model.entities.each do |ent|
      # Components at root level
      if ent.is_a?(Sketchup::ComponentInstance)
        f = ent.get_attribute(DICT_NAME, KEY_FLOOR)
        z = ent.get_attribute(DICT_NAME, KEY_ZONE)
        j = ent.get_attribute(DICT_NAME, KEY_JOB)
        if f && z && j
          ent.hidden = !visible_task_keys.include?(task_key(f, z, j))
        end
      end

      # Zone groups
      if ent.is_a?(Sketchup::Group)
        loc_floor = ent.get_attribute(DICT_NAME, KEY_FLOOR)
        loc_zone  = ent.get_attribute(DICT_NAME, KEY_ZONE)
        if loc_floor && loc_zone
          # First pass: show/hide child components
          has_visible_child = false
          ent.entities.each do |child|
            if child.is_a?(Sketchup::ComponentInstance)
              f = child.get_attribute(DICT_NAME, KEY_FLOOR)
              z = child.get_attribute(DICT_NAME, KEY_ZONE)
              j = child.get_attribute(DICT_NAME, KEY_JOB)
              if f && z && j
                visible = visible_task_keys.include?(task_key(f, z, j))
                child.hidden = !visible
                has_visible_child = true if visible
              end
            end
          end
          # Hide the zone group itself if none of its children are visible
          ent.hidden = !has_visible_child
        end
      end
    end

    model.commit_operation
  end

  # ── Unhide All ─────────────────────────────────────────────────────────────
  def self.unhide_all_entities
    model = Sketchup.active_model
    model.start_operation('Unhide All', true)
    model.entities.each do |ent|
      ent.hidden = false if ent.respond_to?(:hidden=)
      if ent.is_a?(Sketchup::Group)
        ent.entities.each do |child|
          child.hidden = false if child.respond_to?(:hidden=)
        end
      end
    end
    model.commit_operation
  end

  # ── Zoom to Task ───────────────────────────────────────────────────────────
  # task_key: "floor||zone_room" OR "floor||zone_room||job_type"
  def self.zoom_to_task(key)
    return unless key
    parts = key.split('||')
    return unless parts.length == 2 || parts.length == 3
    
    t_floor = parts[0]
    t_zone  = parts[1]
    t_job   = parts[2] # nil if 2 parts

    model       = Sketchup.active_model
    target_ent  = nil
    parent_group = nil

    model.entities.each do |ent|
      if ent.is_a?(Sketchup::Group)
        f_group = ent.get_attribute(DICT_NAME, KEY_FLOOR)
        z_group = ent.get_attribute(DICT_NAME, KEY_ZONE)
        
        # If looking for zone group, check group matches
        if t_job.nil?
          if f_group == t_floor && z_group == t_zone
            target_ent = ent
            break
          end
        end

        # If looking for job, look inside group
        if target_ent.nil? && !t_job.nil?
          ent.entities.each do |child|
            if child.is_a?(Sketchup::ComponentInstance)
              f = child.get_attribute(DICT_NAME, KEY_FLOOR)
              z = child.get_attribute(DICT_NAME, KEY_ZONE)
              j = child.get_attribute(DICT_NAME, KEY_JOB)
              if f == t_floor && z == t_zone && j == t_job
                target_ent   = child
                parent_group = ent
                break
              end
            end
          end
        end
      elsif ent.is_a?(Sketchup::ComponentInstance)
        if !t_job.nil?
          f = ent.get_attribute(DICT_NAME, KEY_FLOOR)
          z = ent.get_attribute(DICT_NAME, KEY_ZONE)
          j = ent.get_attribute(DICT_NAME, KEY_JOB)
          target_ent = ent if f == t_floor && z == t_zone && j == t_job
        end
      end
      break if target_ent
    end

    return unless target_ent

    model.selection.clear
    if t_job.nil?
      # ── Zooming to Zone Group ──
      model.active_path = nil
      model.selection.add(target_ent)
      UI.start_timer(0.05, false) do
        center = target_ent.bounds.center
        diag   = [target_ent.bounds.diagonal, 300.0].max
        # Camera above and to the side, looking down at ~45°
        eye = Geom::Point3d.new(
          center.x + diag * 0.7,
          center.y - diag * 0.7,
          center.z + diag * 1.0
        )
        cam = Sketchup::Camera.new(eye, center, Z_AXIS)
        model.active_view.camera = cam
        # Do NOT call view.zoom(entity) — it flips the camera direction!
      end
    else
      # ── Zooming to Job Component ──
      model.active_path = parent_group ? [parent_group] : nil
      model.selection.add(target_ent)
      UI.start_timer(0.05, false) do
        # After active_path is set, the view uses LOCAL coords.
        center = target_ent.bounds.center
        diag   = [target_ent.bounds.diagonal, 300.0].max
        eye = Geom::Point3d.new(
          center.x + diag * 0.7,
          center.y - diag * 0.7,
          center.z + diag * 1.0
        )
        cam = Sketchup::Camera.new(eye, center, Z_AXIS)
        model.active_view.camera = cam
        # Do NOT call view.zoom(entity) — it flips the camera direction!
      end
    end
  end

  # ── Zoom to Defect Component ───────────────────────────────────────────────
  def self.zoom_to_defect(number_code)
    return unless number_code

    model        = Sketchup.active_model
    target_ent   = nil
    parent_group = nil

    # Search at top-level and inside groups
    model.entities.each do |ent|
      if ent.is_a?(Sketchup::Group)
        ent.entities.each do |child|
          if child.is_a?(Sketchup::ComponentInstance)
            dc = child.get_attribute(DICT_NAME, KEY_DEFECT)
            if dc == number_code
              target_ent   = child
              parent_group = ent
              break
            end
          end
        end
      elsif ent.is_a?(Sketchup::ComponentInstance)
        dc = ent.get_attribute(DICT_NAME, KEY_DEFECT)
        target_ent = ent if dc == number_code
      end
      break if target_ent
    end

    return unless target_ent

    model.selection.clear
    model.active_path = parent_group ? [parent_group] : nil
    model.selection.add(target_ent)

    UI.start_timer(0.05, false) do
      center = target_ent.bounds.center
      diag   = [target_ent.bounds.diagonal, 300.0].max
      eye = Geom::Point3d.new(
        center.x + diag * 0.7,
        center.y - diag * 0.7,
        center.z + diag * 1.0
      )
      cam = Sketchup::Camera.new(eye, center, Z_AXIS)
      model.active_view.camera = cam
    end
  end

  # ── Redraw Selected Model ──────────────────────────────────────────────────
  def self.redraw_selected_model(data)
    model = Sketchup.active_model
    entity = model.selection.first
    return unless entity

    progress = data['progress'] ? data['progress'].to_s.tr('%', '').to_f : nil
    return unless progress

    model.start_operation('Redraw Selected Model', true)
    if entity.is_a?(Sketchup::Group)
      apply_zone_material(entity, progress)
    elsif entity.is_a?(Sketchup::ComponentInstance)
      apply_task_material(entity, progress)
    end
    model.commit_operation
    
    model.active_view.invalidate
  end

  # ── Heatmap ────────────────────────────────────────────────────────────────
  # data['tasks']     = { "floor||zone_room||job_type" => progress_float }
  # data['locations'] = { "floor||zone_room"           => avg_progress_float }
  def self.update_heatmap(data)
    model = Sketchup.active_model
    model.start_operation('Update Progress Heatmap', true)

    model.entities.each do |ent|
      if ent.is_a?(Sketchup::Group)
        f = ent.get_attribute(DICT_NAME, KEY_FLOOR)
        z = ent.get_attribute(DICT_NAME, KEY_ZONE)
        if f && z && data['locations']
          k = zone_key(f, z)
          apply_zone_material(ent, data['locations'][k].to_f) if data['locations'][k]
        end
        ent.entities.each do |child|
          if child.is_a?(Sketchup::ComponentInstance)
            f2 = child.get_attribute(DICT_NAME, KEY_FLOOR)
            z2 = child.get_attribute(DICT_NAME, KEY_ZONE)
            j2 = child.get_attribute(DICT_NAME, KEY_JOB)
            if f2 && z2 && j2 && data['tasks']
              k = task_key(f2, z2, j2)
              apply_task_material(child, data['tasks'][k].to_f) if data['tasks'][k]
            end
          end
        end
      elsif ent.is_a?(Sketchup::ComponentInstance)
        f = ent.get_attribute(DICT_NAME, KEY_FLOOR)
        z = ent.get_attribute(DICT_NAME, KEY_ZONE)
        j = ent.get_attribute(DICT_NAME, KEY_JOB)
        if f && z && j && data['tasks']
          k = task_key(f, z, j)
          apply_task_material(ent, data['tasks'][k].to_f) if data['tasks'][k]
        end
      end
    end

    model.commit_operation
  end

  # ── Materials ──────────────────────────────────────────────────────────────
  # 3-band traffic light gradient: Red(0%) → Amber(50%) → Green(100%)
  def self.progress_color(p)
    red   = [220,  55,  55]
    amber = [255, 185,  30]
    green = [ 45, 185,  75]
    if p <= 50
      t = p / 50.0
      r = (red[0] + t * (amber[0] - red[0])).round
      g = (red[1] + t * (amber[1] - red[1])).round
      b = (red[2] + t * (amber[2] - red[2])).round
    else
      t = (p - 50) / 50.0
      r = (amber[0] + t * (green[0] - amber[0])).round
      g = (amber[1] + t * (green[1] - amber[1])).round
      b = (amber[2] + t * (green[2] - amber[2])).round
    end
    [r, g, b]
  end

  # Task components — solid so progress reads clearly on geometry
  def self.apply_task_material(entity, progress)
    p        = [[progress, 0].max, 100].min
    r, g, b  = progress_color(p)
    mat_name = "CP_Task_#{p.to_i}"
    mat      = Sketchup.active_model.materials[mat_name] ||
               Sketchup.active_model.materials.add(mat_name)
    mat.color = Sketchup::Color.new(r, g, b)
    entity.material = mat
  end

  # Zone groups — same palette, 0.5 alpha overlay so geometry shows through
  def self.apply_zone_material(entity, progress)
    p        = [[progress, 0].max, 100].min
    r, g, b  = progress_color(p)
    mat_name = "CP_Zone_#{p.to_i}"
    mat      = Sketchup.active_model.materials[mat_name] ||
               Sketchup.active_model.materials.add(mat_name)
    mat.color = Sketchup::Color.new(r, g, b)
    mat.alpha = 0.5
    entity.material = mat
  end

  # ── Menu & Toolbar ─────────────────────────────────────────────────────────
  unless file_loaded?(__FILE__)
    # ── Plugins Menu ──
    menu = UI.menu('Plugins').add_submenu('Construction Progress')
    menu.add_item('Inspector') { show_inspector }
    menu.add_separator
    menu.add_item('Sign Out') do
      if @dialog && @dialog.visible?
        @dialog.execute_script("if(typeof doSignOutFromRuby === 'function') { doSignOutFromRuby(); } else if(window.__vueApp && window.__vueApp.doSignOut) { window.__vueApp.doSignOut(); }")
      else
        UI.messagebox("Please open the Inspector first before signing out.")
      end
    end

    # ── Toolbar ──
    toolbar = UI::Toolbar.new("Construction Progress")

    # Open Inspector button
    cmd_inspector = UI::Command.new("Inspector") { show_inspector }
    cmd_inspector.tooltip      = "Open Construction Progress Inspector"
    cmd_inspector.status_bar_text = "Open Construction Progress Inspector"
    cmd_inspector.small_icon   = File.join(__dir__, 'icons', 'inspector_16.png')
    cmd_inspector.large_icon   = File.join(__dir__, 'icons', 'inspector_24.png')
    toolbar.add_item(cmd_inspector)

    toolbar.add_separator

    # Sign Out button
    cmd_signout = UI::Command.new("Sign Out") do
      if @dialog && @dialog.visible?
        @dialog.execute_script("if(typeof doSignOutFromRuby === 'function') { doSignOutFromRuby(); }")
      else
        UI.messagebox("Please open the Inspector first.")
      end
    end
    cmd_signout.tooltip      = "Sign Out from Construction Progress"
    cmd_signout.status_bar_text = "Sign Out current user"
    cmd_signout.small_icon   = File.join(__dir__, 'icons', 'signout_16.png')
    cmd_signout.large_icon   = File.join(__dir__, 'icons', 'signout_24.png')
    toolbar.add_item(cmd_signout)

    toolbar.restore

    file_loaded(__FILE__)
  end
end
