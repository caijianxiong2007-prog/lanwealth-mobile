require 'json'
require 'xcodeproj'

root = File.expand_path('..', __dir__)
config = JSON.parse(File.read(File.join(root, 'app.json')))['expo']
raise 'Wrong app identity' unless config.dig('ios', 'bundleIdentifier') == 'cn.lanwealth.baize'

vendor = File.expand_path('~/.codex/cache/bayze-ios-vendor/SDWebImage-5.21.7')
raise 'Restore the official SDWebImage 5.21.7 source into the persistent cache first' unless File.file?(File.join(vendor, 'WebImage', 'SDWebImage.h'))
podfile = File.join(root, 'ios', 'Podfile')
content = File.read(podfile)
old_vendor = "pod 'SDWebImage', :path => '/tmp/pod-vendor/SDWebImage-vendor'"
stable_vendor = "pod 'SDWebImage', :path => File.expand_path('~/.codex/cache/bayze-ios-vendor/SDWebImage-5.21.7')"
raise 'Unexpected vendor configuration' unless content.include?(old_vendor) || content.include?(stable_vendor)
File.write(podfile, content.sub(old_vendor, stable_vendor))

project = Xcodeproj::Project.open(File.join(root, 'ios', 'Bayze.xcodeproj'))
%w[Bayze BayzeShare].each do |name|
  target = project.targets.find { |candidate| candidate.name == name }
  raise "Missing target #{name}" unless target
  relative = "#{name}/PrivacyInfo.xcprivacy"
  absolute = File.join(root, 'ios', relative)
  raise "Missing privacy manifest for #{name}" unless File.file?(absolute)

  # Each target must package its own manifest; sharing the extension reference
  # loses the main app's required API reasons and breaks CocoaPods aggregation.
  group = project.main_group.find_subpath(name, true)
  reference = project.files.find { |file| [absolute, relative].include?(file.path) }
  reference ||= group.new_file(relative)
  parents = reference.referrers.grep(Xcodeproj::Project::Object::PBXGroup)
  group.children << reference if parents.empty?
  raise "Unexpected manifest parent for #{name}" unless reference.real_path.to_s == absolute
  retained = false
  target.resources_build_phase.files.to_a.each do |entry|
    next unless entry.file_ref&.path&.end_with?('PrivacyInfo.xcprivacy')
    if entry.file_ref == reference && !retained
      retained = true
    else
      target.resources_build_phase.remove_build_file(entry)
    end
  end
  target.resources_build_phase.add_file_reference(reference, true) unless retained
end
project.save
puts 'Prepared persistent vendor path and target-specific privacy manifests.'
