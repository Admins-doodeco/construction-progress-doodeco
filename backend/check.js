
    const API_URL = 'http://localhost:3001/api';
    const API_KEY = 'CP-SKETCHUP-SECRET-KEY-2024';

    // Override fetch to always include API key
    const originalFetch = window.fetch;
    window.fetch = function () {
      let [resource, config] = arguments;
      if (typeof resource === 'string' && resource.startsWith(API_URL)) {
        config = config || {};
        config.headers = config.headers || {};
        config.headers['x-api-key'] = API_KEY;
      }
      return originalFetch(resource, config);
    };

    const { createApp, ref, computed, onMounted, watch } = Vue;

    createApp({
      setup() {
        const loading = ref(false);
        const activeTab = ref('inspector');

        const modal = ref({ show: false, type: 'alert', title: '', message: '', onConfirm: null, onCancel: null });

        const showAlert = (title, message) => {
          modal.value = {
            show: true, type: 'alert', title, message,
            onConfirm: () => { modal.value.show = false; }
          };
        };

        const showConfirm = (title, message) => {
          return new Promise((resolve) => {
            modal.value = {
              show: true, type: 'confirm', title, message,
              onConfirm: () => { modal.value.show = false; resolve(true); },
              onCancel: () => { modal.value.show = false; resolve(false); }
            };
          });
        };

        // Inspector State
        const selection = ref({ type: null, mapped: false });
        const locations = ref([]);
        const tasks = ref([]);
        const searchQuery = ref('');
        const selectedLocationId = ref(null);
        const selectedTaskId = ref(null);
        const currentLocation = ref(null);
        const currentTask = ref(null);
        const locationTasks = ref([]);

        // Report State
        const reportTasks = ref([]);
        const historyDate = ref('');
        // allMappedTaskKeys: array of "floor||zone_room||job_type" natural composite keys
        const allMappedTaskKeys = ref([]);
        const filters = ref({ floor: '', zone: '', job_type: '', supplier: '', progress: '' });
        const sort = ref({ key: 'floor', order: 'asc' });
        const dropdowns = ref({ floor: false, zone: false, job_type: false, supplier: false, progress: false });

        const setFilter = (key, value) => {
          filters.value[key] = value;
          dropdowns.value[key] = false;
          applyFilters();
        };

        const hideDropdown = (key) => {
          setTimeout(() => dropdowns.value[key] = false, 150);
        };

        const parseToIsoDate = (dStr) => {
          if (!dStr) return '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;

          const parts = dStr.split(/[/-]/);
          if (parts.length === 3 && parts[2].length === 4) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }

          const d = new Date(dStr);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

          return '';
        };

        const processTaskDates = (task) => {
          if (task.start_date) task.start_date = parseToIsoDate(task.start_date);
          if (task.finish_date) task.finish_date = parseToIsoDate(task.finish_date);
          if (task.updated_date) task.updated_date = parseToIsoDate(task.updated_date);
          return task;
        };

        const getTodayIsoDate = () => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        };

        const markUpdated = (task) => {
          if (!historyDate.value) {
            task.updated_date = getTodayIsoDate();
          }
        };

        const fetchHistory = async () => {
          if (!historyDate.value) return clearHistory();
          loading.value = true;
          try {
            const res = await fetch(`${API_URL}/history?date=${historyDate.value}`);
            const rawData = await res.json();
            reportTasks.value = rawData.map(processTaskDates);
            await refreshHeatmap(); // Auto-update heatmap for the selected date
          } catch (e) { console.error(e); }
          loading.value = false;
        };

        const clearHistory = async () => {
          historyDate.value = '';
          loading.value = true;
          try {
            const res = await fetch(`${API_URL}/tasks`);
            const rawData = await res.json();
            reportTasks.value = rawData.map(processTaskDates);
            await refreshHeatmap(); // Auto-update heatmap back to current state
          } catch (e) { console.error(e); }
          loading.value = false;
        };

        const downloadCsv = () => {
          if (sortedFilteredReportTasks.value.length === 0) return;

          const headers = [
            "Floor", "Zone/Room", "Job Type", "Progress", "Start Date",
            "Finish Date", "Area Finish", "Area Remaining",
            "Manpower Plan", "Manpower Actual", "Material", "Supplier", "Remark", "Mapped to Model"
          ];

          const rows = sortedFilteredReportTasks.value.map(t => {
            return [
              `"${t.location.floor}"`,
              `"${t.location.zone_room}"`,
              `"${t.job_type}"`,
              `"${t.progress || ''}"`,
              `"${t.start_date || ''}"`,
              `"${t.finish_date || ''}"`,
              `"${t.area_finish || ''}"`,
              `"${t.area_remaining || ''}"`,
              `"${t.manpower_plan || ''}"`,
              `"${t.manpower_actual || ''}"`,
              `"${t.material || ''}"`,
              `"${t.supplier || ''}"`,
              `"${t.remark || ''}"`,
              allMappedTaskKeys.value.includes(`${t.location.floor}||${t.location.zone_room}||${t.job_type}`) ? '"Yes"' : '"No"'
            ].join(',');
          });

          const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
          const encodedUri = encodeURI(csvContent);
          const link = document.createElement("a");
          link.setAttribute("href", encodedUri);
          link.setAttribute("download", `Construction_Progress_Report.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        };

        const statusMessage = ref('');
        const loadingHeatmap = ref(false);

        const showStatus = (msg) => {
          statusMessage.value = msg;
          setTimeout(() => statusMessage.value = '', 3000);
        };

        const switchTab = async (tab) => {
          activeTab.value = tab;
          if (tab === 'report') {
            if (window.sketchup) window.sketchup.resizeDialog({ width: 1200, height: 700 });
            loading.value = true;

            try {
              const res = await fetch(`${API_URL}/tasks`);
              const rawData = await res.json();
              reportTasks.value = rawData.map(processTaskDates);
            } catch (e) { console.error(e); }
            loading.value = false;

            // Ask Ruby for mapped IDs — applyFilters is triggered inside receiveMappedTasks
            if (window.sketchup) window.sketchup.getAllMappedTasks();
          } else {
            // Switching TO Inspector: always restore full visibility.
            // filterModels is a Report-only feature; never call it here.
            if (window.sketchup) {
              window.sketchup.resizeDialog({ width: 350, height: 600 });
              window.sketchup.unhideAll();
            }
          }
        };

        // Called from Ruby after getAllMappedTasks() — receives composite natural keys
        window.receiveMappedTasks = function (keys) {
          allMappedTaskKeys.value = keys;
          if (activeTab.value === 'report') {
            applyFilters();
          }
        };

        const uniqueFloors = computed(() => [...new Set(reportTasks.value.map(t => t.location && t.location.floor))].filter(Boolean).sort());
        const uniqueZones = computed(() => [...new Set(reportTasks.value.map(t => t.location && t.location.zone_room))].filter(Boolean).sort());
        const uniqueJobTypes = computed(() => [...new Set(reportTasks.value.map(t => t.job_type))].filter(Boolean).sort());
        const uniqueSuppliers = computed(() => [...new Set(reportTasks.value.map(t => t.supplier))].filter(Boolean).sort());
        const uniqueProgresses = computed(() => [...new Set(reportTasks.value.map(t => t.progress))].filter(Boolean).sort());

        const sortedFilteredReportTasks = computed(() => {
          let result = reportTasks.value;

          // Apply Filters
          const fFloor = filters.value.floor.toLowerCase();
          const fZone = filters.value.zone.toLowerCase();
          const fJob = filters.value.job_type.toLowerCase();
          const fSupp = filters.value.supplier.toLowerCase();
          const fProg = filters.value.progress.toLowerCase();

          if (fFloor || fZone || fJob || fSupp || fProg) {
            result = result.filter(t => {
              const floorMatch = !fFloor || (t.location && t.location.floor.toLowerCase().includes(fFloor));
              const zoneMatch = !fZone || (t.location && t.location.zone_room.toLowerCase().includes(fZone));
              const jobMatch = !fJob || (t.job_type && t.job_type.toLowerCase().includes(fJob));
              const suppMatch = !fSupp || (t.supplier && t.supplier.toLowerCase().includes(fSupp));
              const progMatch = !fProg || (t.progress && t.progress.toLowerCase().includes(fProg));
              return floorMatch && zoneMatch && jobMatch && suppMatch && progMatch;
            });
          }

          // Apply Sort
          result.sort((a, b) => {
            let valA, valB;
            if (sort.value.key === 'status') {
              valA = allMappedTaskKeys.value.includes(`${a.location.floor}||${a.location.zone_room}||${a.job_type}`) ? 1 : 0;
              valB = allMappedTaskKeys.value.includes(`${b.location.floor}||${b.location.zone_room}||${b.job_type}`) ? 1 : 0;
            } else if (sort.value.key === 'floor') { valA = a.location.floor; valB = b.location.floor; }
            else if (sort.value.key === 'zone') { valA = a.location.zone_room; valB = b.location.zone_room; }
            else if (sort.value.key === 'job_type') { valA = a.job_type; valB = b.job_type; }

            if (valA < valB) return sort.value.order === 'asc' ? -1 : 1;
            if (valA > valB) return sort.value.order === 'asc' ? 1 : -1;
            return 0;
          });

          return result;
        });

        // Trigger filter in SketchUp using natural composite keys
        const applyFilters = () => {
          if (activeTab.value !== 'report') return;
          if (window.sketchup) {
            const visibleKeys = sortedFilteredReportTasks.value.map(t =>
              `${t.location.floor}||${t.location.zone_room}||${t.job_type}`
            );
            // Guard: only filter when we have both mapped keys loaded and visible keys
            if (allMappedTaskKeys.value.length === 0 && visibleKeys.length === 0) return;
            window.sketchup.filterModels({ visible_task_keys: visibleKeys });
          }
        };

        const expandedGroups = ref({});
        const toggleGroup = (key) => {
          expandedGroups.value[key] = !expandedGroups.value[key];
        };

        const groupedReportTasks = computed(() => {
          const groups = {};
          sortedFilteredReportTasks.value.forEach(task => {
            const key = `${task.location.floor}||${task.location.zone_room}`;
            if (!groups[key]) {
              groups[key] = {
                floor: task.location.floor,
                zone_room: task.location.zone_room,
                key: key,
                tasks: [],
                expanded: !!expandedGroups.value[key],
                anyMapped: false,
                totalProgress: 0,
                countProgress: 0,
                totalAreaFinish: 0,
                totalAreaRemaining: 0,
                totalManpowerPlan: 0,
                totalManpowerActual: 0,
                minStart: null,
                maxFinish: null
              };
            }
            groups[key].tasks.push(task);
            
            // map status
            const tKey = `${task.location.floor}||${task.location.zone_room}||${task.job_type}`;
            if (allMappedTaskKeys.value.includes(tKey)) groups[key].anyMapped = true;
            
            // progress
            const p = parseProgress(task.progress);
            groups[key].totalProgress += p;
            groups[key].countProgress += 1;

            // numbers
            const af = parseFloat(task.area_finish); if (!isNaN(af)) groups[key].totalAreaFinish += af;
            const ar = parseFloat(task.area_remaining); if (!isNaN(ar)) groups[key].totalAreaRemaining += ar;
            const mp = parseFloat(task.manpower_plan); if (!isNaN(mp)) groups[key].totalManpowerPlan += mp;
            const ma = parseFloat(task.manpower_actual); if (!isNaN(ma)) groups[key].totalManpowerActual += ma;

            // dates
            if (task.start_date) {
              if (!groups[key].minStart || task.start_date < groups[key].minStart) groups[key].minStart = task.start_date;
            }
            if (task.finish_date) {
              if (!groups[key].maxFinish || task.finish_date > groups[key].maxFinish) groups[key].maxFinish = task.finish_date;
            }
          });

          return Object.values(groups).map(g => {
            g.avgProgress = g.countProgress ? Math.round(g.totalProgress / g.countProgress) : 0;
            // format floats
            g.totalAreaFinish = g.totalAreaFinish > 0 ? parseFloat(g.totalAreaFinish.toFixed(2)) : 0;
            g.totalAreaRemaining = g.totalAreaRemaining > 0 ? parseFloat(g.totalAreaRemaining.toFixed(2)) : 0;
            g.totalManpowerPlan = g.totalManpowerPlan > 0 ? parseFloat(g.totalManpowerPlan.toFixed(2)) : 0;
            g.totalManpowerActual = g.totalManpowerActual > 0 ? parseFloat(g.totalManpowerActual.toFixed(2)) : 0;
            return g;
          });
        });

        const expandAll = () => {
          groupedReportTasks.value.forEach(g => {
            expandedGroups.value[g.key] = true;
          });
        };
        const collapseAll = () => {
          expandedGroups.value = {};
        };

        const zoomToZone = (group) => {
          const key = `${group.floor}||${group.zone_room}`;
          if (window.sketchup) {
            window.sketchup.zoomToTask({ task_key: key });
          }
        };

        const sortBy = (key) => {
          if (sort.value.key === key) {
            sort.value.order = sort.value.order === 'asc' ? 'desc' : 'asc';
          } else {
            sort.value.key = key;
            sort.value.order = 'asc';
          }
        };

        // taskKey: "floor||zone_room||job_type"
        const zoomToModel = (task) => {
          const key = `${task.location.floor}||${task.location.zone_room}||${task.job_type}`;
          if (window.sketchup && allMappedTaskKeys.value.includes(key)) {
            window.sketchup.zoomToTask({ task_key: key });
          }
        };

        // Heatmap
        const parseProgress = (pStr) => {
          if (!pStr) return 0;
          const num = parseInt(pStr.replace('%', '').trim());
          return isNaN(num) ? 0 : num;
        };

        const refreshHeatmap = async () => {
          loadingHeatmap.value = true;
          try {
            const endpoint = historyDate.value ? `${API_URL}/history?date=${historyDate.value}` : `${API_URL}/tasks`;
            const res = await fetch(endpoint);
            const allTasks = await res.json();
            // Use natural composite keys — stable across reseeds
            const payload = { tasks: {}, locations: {} };
            const locSums = {};
            const locCounts = {};

            allTasks.forEach(task => {
              const taskKey = `${task.location.floor}||${task.location.zone_room}||${task.job_type}`;
              const zoneKey = `${task.location.floor}||${task.location.zone_room}`;
              const p = parseProgress(task.progress);
              payload.tasks[taskKey] = p;
              if (!locSums[zoneKey]) { locSums[zoneKey] = 0; locCounts[zoneKey] = 0; }
              locSums[zoneKey] += p;
              locCounts[zoneKey] += 1;
            });
            Object.keys(locSums).forEach(zoneKey => {
              payload.locations[zoneKey] = locSums[zoneKey] / locCounts[zoneKey];
            });
            if (window.sketchup) {
              window.sketchup.updateHeatmap(payload);
              showStatus("Heatmap Applied!");
            }
          } catch (e) { showAlert("Error", "Error applying heatmap: " + e.message); }
          loadingHeatmap.value = false;
        };

        // Inspector logic
        const filteredLocations = computed(() => {
          if (!searchQuery.value) return locations.value;
          const q = searchQuery.value.toLowerCase();
          return locations.value.filter(l => l.zone_room.toLowerCase().includes(q) || l.floor.toLowerCase().includes(q));
        });

        const filteredTasks = computed(() => {
          if (!searchQuery.value) return tasks.value;
          const q = searchQuery.value.toLowerCase();
          return tasks.value.filter(t => t.job_type.toLowerCase().includes(q) || t.location.zone_room.toLowerCase().includes(q));
        });

        window.updateSelection = async function (data) {
          if (activeTab.value !== 'inspector') return;
          selection.value = data;
          searchQuery.value = '';
          selectedLocationId.value = null;
          selectedTaskId.value = null;
          locationTasks.value = [];

          if (!data.type) return;

          loading.value = true;

          if (data.mapped) {
            // Lookup by natural keys — works even after DB reseed
            if (data.type === 'Group' && data.cp_floor && data.cp_zone_room) {
              const locRes = await fetch(`${API_URL}/locations/lookup?floor=${encodeURIComponent(data.cp_floor)}&zone_room=${encodeURIComponent(data.cp_zone_room)}`);
              currentLocation.value = await locRes.json();
              const tasksRes = await fetch(`${API_URL}/tasks?floor=${encodeURIComponent(data.cp_floor)}&zone_room=${encodeURIComponent(data.cp_zone_room)}`);
              const rawTasks = await tasksRes.json();
              locationTasks.value = rawTasks.map(processTaskDates);
            } else if (data.type === 'ComponentInstance' && data.cp_floor && data.cp_zone_room && data.cp_job_type) {
              const res = await fetch(`${API_URL}/tasks/lookup?floor=${encodeURIComponent(data.cp_floor)}&zone_room=${encodeURIComponent(data.cp_zone_room)}&job_type=${encodeURIComponent(data.cp_job_type)}`);
              currentTask.value = processTaskDates(await res.json());
            }
          } else {
            if (data.type === 'Group') {
              const res = await fetch(`${API_URL}/locations`);
              locations.value = await res.json();
            } else if (data.type === 'ComponentInstance') {
              // Filter task list by parent zone if available
              let url = `${API_URL}/tasks`;
              if (data.parent_floor && data.parent_zone_room) {
                url += `?floor=${encodeURIComponent(data.parent_floor)}&zone_room=${encodeURIComponent(data.parent_zone_room)}`;
              }
              const res = await fetch(url);
              const rawTasks = await res.json();
              tasks.value = rawTasks.map(processTaskDates);
            }
          }
          loading.value = false;
        };

        const assignLocation = () => {
          const loc = locations.value.find(l => l.id === selectedLocationId.value);
          if (loc && window.sketchup) {
            // Pass natural keys — no UUIDs stored in SketchUp entity
            window.sketchup.assignItem({
              type: 'Group',
              floor: loc.floor,
              zone_room: loc.zone_room,
              name: `${loc.zone_room} (${loc.floor})`,
              tag: loc.floor
            });
            showStatus("Zone Assigned!");
          }
        };

        const assignTask = () => {
          const task = tasks.value.find(t => t.id === selectedTaskId.value);
          if (task && window.sketchup) {
            // Pass natural keys — stable across reseeds and model copies
            window.sketchup.assignItem({
              type: 'ComponentInstance',
              floor: task.location.floor,
              zone_room: task.location.zone_room,
              job_type: task.job_type,
              name: `${task.job_type} (${task.location.zone_room} - ${task.location.floor})`,
              tag: task.job_type
            });
            showStatus("Job Type Assigned!");
          }
        };

        const unassignItem = () => {
          if (window.sketchup) { window.sketchup.unassignItem(); showStatus("Item Unassigned"); }
        };

        const saveTask = async (taskObj) => {
          if (!taskObj) return;
          try {
            const res = await fetch(`${API_URL}/tasks/${taskObj.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(taskObj)
            });
            if (res.ok) {
              showStatus("Data Saved Successfully!");
              showAlert("Success", "Data Saved Successfully!");
            } else {
              const err = await res.json();
              showAlert("Error", err.error || "Failed to save data");
            }
          } catch (e) {
            showAlert("Error", "Error saving: " + e.message);
          }
        };

        // Unhide all models in SketchUp — safety net button
        const unhideAll = () => {
          if (window.sketchup) {
            window.sketchup.unhideAll();
            showStatus('All models are now visible.');
          }
        };

        const uploadingImages = ref(false);

        const uploadImages = async (event, taskObj) => {
          if (!taskObj || !!historyDate.value) return;
          const files = event.target.files;
          if (!files.length) return;

          const currentCount = taskObj.images ? taskObj.images.length : 0;
          if (currentCount + files.length > 10) {
            showAlert("Limit Reached", "Maximum 10 images allowed per task.");
            return;
          }

          const base64Images = [];
          for (let i = 0; i < files.length; i++) {
            if (files[i].size > 5 * 1024 * 1024) {
              showAlert("File too large", `File ${files[i].name} is larger than 5MB.`);
              return;
            }
            
            // Read file as Base64 to bypass CEF FormData truncation bug
            const reader = new FileReader();
            const promise = new Promise((resolve, reject) => {
              reader.onload = () => resolve({ name: files[i].name, base64: reader.result });
              reader.onerror = error => reject(error);
            });
            reader.readAsDataURL(files[i]);
            base64Images.push(await promise);
          }

          uploadingImages.value = true;
          try {
            const res = await fetch(`${API_URL}/tasks/${taskObj.id}/images`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ images: base64Images })
            });
            if (res.ok) {
              const newImages = await res.json();
              if (!taskObj.images) taskObj.images = [];
              taskObj.images.push(...newImages);
              showStatus("Images Uploaded Successfully!");
            } else {
              const err = await res.json();
              showAlert("Upload Failed", err.error || "Upload failed");
            }
          } catch (e) {
            showAlert("Error", "Error uploading images: " + e.message);
          }
          uploadingImages.value = false;
          event.target.value = ''; // Reset input
        };

        const deleteImage = async (taskObj, imageId) => {
          if (!taskObj || !!historyDate.value) return;
          const confirmed = await showConfirm("Confirm Delete", "Are you sure you want to delete this image?");
          if (!confirmed) return;
          
          try {
            const res = await fetch(`${API_URL}/tasks/${taskObj.id}/images/${imageId}`, {
              method: 'DELETE'
            });
            if (res.ok) {
              taskObj.images = taskObj.images.filter(i => i.id !== imageId);
              showStatus("Image Deleted!");
            } else {
              const err = await res.json();
              showAlert("Delete Failed", err.error || "Delete failed");
            }
          } catch (e) {
            showAlert("Error", "Error deleting image: " + e.message);
          }
        };

        return {
          loading, activeTab, selection, locations, tasks, searchQuery,
          selectedLocationId, selectedTaskId, filteredLocations, filteredTasks,
          currentLocation, currentTask, statusMessage, locationTasks, loadingHeatmap,
          reportTasks, historyDate, allMappedTaskKeys, filters, sort, sortedFilteredReportTasks,
          groupedReportTasks, expandedGroups, toggleGroup, expandAll, collapseAll, zoomToZone,
          uniqueFloors, uniqueZones, uniqueJobTypes, uniqueSuppliers, uniqueProgresses,
          dropdowns, setFilter, hideDropdown,
          switchTab, applyFilters, sortBy, zoomToModel, downloadCsv,
          assignLocation, assignTask, unassignItem, saveTask, refreshHeatmap, unhideAll,
          fetchHistory, clearHistory, markUpdated,
          uploadingImages, uploadImages, deleteImage,
          modal, showAlert, showConfirm
        }
      }
    }).mount('#app')
  