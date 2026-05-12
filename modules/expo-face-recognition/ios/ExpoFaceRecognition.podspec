require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoFaceRecognition'
  s.version        = package['version'] || '1.0.0'
  s.summary        = 'On-device face detection and embedding extraction via Apple Vision + CoreML'
  s.description    = 'Expo native module that detects faces in images using Apple Vision framework and extracts 128-dimensional embeddings using a MobileFaceNet CoreML model for on-device face recognition.'
  s.homepage       = 'https://github.com/nicojoy-mittens/mittens-open'
  s.license        = 'Apache-2.0'
  s.author         = 'Mittens'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }

  s.dependency 'ExpoModulesCore'

  s.source_files   = '*.swift'
  s.frameworks     = 'Vision', 'CoreML', 'CoreImage', 'UIKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.swift_version  = '5.9'
end
