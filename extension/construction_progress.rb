require 'sketchup.rb'
require 'extensions.rb'

module ConstructionProgress
  unless file_loaded?(__FILE__)
    ex = SketchupExtension.new('Construction Progress', 'construction_progress/main')
    ex.description = 'Manage Construction Progress using Inspector and Database'
    ex.version     = '1.0.0'
    ex.creator     = 'Antigravity'
    Sketchup.register_extension(ex, true)
    file_loaded(__FILE__)
  end
end
