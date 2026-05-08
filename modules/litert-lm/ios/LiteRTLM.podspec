require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiteRTLM'
  s.version        = package['version'] || '0.1.0'
  s.summary        = 'LiteRT-LM Expo module for on-device Gemma inference on iOS'
  s.description    = 'Bridges the LiteRT-LM C API to JavaScript via Expo Modules, enabling on-device Gemma 4 E2B inference.'
  s.homepage       = 'https://github.com/google-ai-edge/LiteRT-LM'
  s.license        = 'Apache-2.0'
  s.author         = 'Mittens'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }

  s.dependency 'ExpoModulesCore'

  # Swift source files (the Expo module)
  s.source_files   = '*.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks @loader_path/Frameworks',
  }

  # The XCFramework contains a DYNAMIC framework (CLiteRTLM.framework).
  # It includes a nested libGemmaModelConstraintProvider.dylib that must be
  # re-signed with the app's identity during the build.
  s.vendored_frameworks = 'Frameworks/CLiteRTLM.xcframework'

  s.swift_version  = '5.9'
end
