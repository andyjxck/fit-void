Pod::Spec.new do |s|
  s.name           = 'WatchSync'
  s.version        = '1.0.0'
  s.summary        = 'WatchConnectivity bridge for the Fit Void watch app'
  s.description    = 'Pushes snapshots to the watch and forwards watch commands to JS.'
  s.homepage       = 'https://dev.local'
  s.license        = 'MIT'
  s.author         = 'Fit Void'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.platform = :ios, '16.4'
  s.swift_version = '5.4'
  s.source_files = '**/*.{h,m,mm,swift}'
end
