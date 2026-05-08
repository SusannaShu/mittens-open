/**
 * Expo config plugin to re-sign the CLiteRTLM.framework's nested dylibs.
 *
 * Problem: The prebuilt CLiteRTLM.xcframework ships with
 * libGemmaModelConstraintProvider.dylib signed by a different team.
 * iOS kills the app at launch because of the team mismatch ("code
 * signature invalid").  CocoaPods' embed script only signs the main
 * framework binary, not nested dylibs.
 *
 * Solution: Two-pronged approach:
 * 1. withXcodeProject → inject a "[LiteRTLM] Re-sign nested dylibs"
 *    PBXShellScriptBuildPhase into the Xcode project.
 * 2. withDangerousMod → after pod install regenerates phase ordering,
 *    patch the .pbxproj text to move the re-sign phase AFTER the
 *    [CP] Embed Pods Frameworks phase (since pod install always
 *    appends its own phases at the end, pushing ours before embed).
 */

const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RESIGN_SCRIPT = [
  '# Re-sign nested dylibs inside CLiteRTLM.framework.',
  '# Check both the CocoaPods intermediate framework and the final app copy so this',
  '# is resilient whether the phase runs before or after [CP] Embed Pods Frameworks.',
  'if [ -z "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then',
  '  echo "[LiteRTLM] ERROR: EXPANDED_CODE_SIGN_IDENTITY is empty; cannot sign nested dylibs"',
  '  exit 1',
  'fi',
  'for FW_PATH in "${PODS_XCFRAMEWORKS_BUILD_DIR}/LiteRTLM/CLiteRTLM.framework" "${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}/CLiteRTLM.framework"; do',
  '  if [ -d "$FW_PATH" ]; then',
  '    echo "[LiteRTLM] Re-signing nested dylibs in $FW_PATH..."',
  '    find "$FW_PATH" -name "*.dylib" | while read -r dylib; do',
  '      /usr/bin/codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" ${OTHER_CODE_SIGN_FLAGS:-} --timestamp=none "$dylib"',
  '    done',
  '    /usr/bin/codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" ${OTHER_CODE_SIGN_FLAGS:-} --timestamp=none "$FW_PATH"',
  '  fi',
  'done',
  'echo "[LiteRTLM] Re-signing complete"',
].join('\\n');

var PHASE_COMMENT = '[LiteRTLM] Re-sign nested dylibs';
var EMBED_COMMENT = '[CP] Embed Pods Frameworks';

function movePhaseAfterEmbed(project, targetObj) {
  var shellPhases = project.hash.project.objects['PBXShellScriptBuildPhase'] || {};
  var liteRTLMIdx = -1;
  var embedIdx = -1;

  targetObj.buildPhases.forEach(function(phase, i) {
    var obj = shellPhases[phase.value];
    var phaseName = (obj && (obj.name || obj.comment)) || '';
    var phaseComment = phase.comment || '';

    if (phaseName.indexOf(PHASE_COMMENT) !== -1 || phaseComment.indexOf(PHASE_COMMENT) !== -1) {
      liteRTLMIdx = i;
    }

    if (phaseName.indexOf(EMBED_COMMENT) !== -1 || phaseComment.indexOf(EMBED_COMMENT) !== -1) {
      embedIdx = i;
    }
  });

  if (liteRTLMIdx !== -1 && embedIdx !== -1 && liteRTLMIdx < embedIdx) {
    var phase = targetObj.buildPhases.splice(liteRTLMIdx, 1)[0];
    embedIdx -= 1;
    targetObj.buildPhases.splice(embedIdx + 1, 0, phase);
    console.log('[LiteRTLM] Moved re-sign build phase after Embed Pods Frameworks');
  }
}

function withResignCLiteRTLM(config) {
  // Step 1: Add the build phase to the Xcode project and ensure it's LAST
  config = withXcodeProject(config, function(cfg) {
    var project = cfg.modResults;
    var mainTargetUuid = project.getFirstTarget().uuid;
    var nativeTargets = project.pbxNativeTargetSection();
    var targetObj = nativeTargets[mainTargetUuid];

    if (!targetObj) {
      console.warn('[LiteRTLM] Could not find main target');
      return cfg;
    }

    var shellPhases = project.hash.project.objects['PBXShellScriptBuildPhase'] || {};

    // Find existing phase index
    var existingIdx = -1;
    targetObj.buildPhases.forEach(function(phase, i) {
      var obj = shellPhases[phase.value];
      if (obj && obj.name && obj.name.indexOf('LiteRTLM') !== -1) {
        existingIdx = i;
      }
    });

    if (existingIdx === -1) {
      // Add it fresh — addBuildPhase appends to the end which is correct
      project.addBuildPhase(
        [],
        'PBXShellScriptBuildPhase',
        PHASE_COMMENT,
        mainTargetUuid,
        {
          shellPath: '/bin/sh',
          shellScript: RESIGN_SCRIPT,
          runOnlyForDeploymentPostprocessing: 0,
        }
      );
      console.log('[LiteRTLM] Added re-sign build phase to Xcode project');
    } else {
      // Already exists — move it to the very end so it always runs after embed
      var phase = targetObj.buildPhases.splice(existingIdx, 1)[0];
      targetObj.buildPhases.push(phase);
      console.log('[LiteRTLM] Moved re-sign build phase to end of buildPhases');
    }

    movePhaseAfterEmbed(project, targetObj);

    return cfg;
  });

  // Step 2: After pod install, fix the ordering in .pbxproj
  // (pod install regenerates and may push our phase before embed)
  config = withDangerousMod(config, [
    'ios',
    async function(cfg) {
      var iosDir = cfg.modRequest.platformProjectRoot;
      var pbxprojPath = path.join(iosDir, 'Mittens.xcodeproj', 'project.pbxproj');

      if (!fs.existsSync(pbxprojPath)) {
        console.warn('[LiteRTLM] pbxproj not found, skipping phase reorder');
        return cfg;
      }

      var content = fs.readFileSync(pbxprojPath, 'utf8');

      // Find lines in buildPhases array: we need the LiteRTLM line
      // to come AFTER the Embed Pods Frameworks line.
      var liteRTLMRegex = /(\s+)([A-F0-9]+)\s+\/\*\s*\[LiteRTLM\] Re-sign nested dylibs\s*\*\/,/;
      var embedRegex = /(\s+)([A-F0-9]+)\s+\/\*\s*\[CP\] Embed Pods Frameworks\s*\*\/,/;

      var liteRTLMMatch = content.match(liteRTLMRegex);
      var embedMatch = content.match(embedRegex);

      if (liteRTLMMatch && embedMatch) {
        var liteRTLMPos = content.indexOf(liteRTLMMatch[0]);
        var embedPos = content.indexOf(embedMatch[0]);

        // Only reorder if LiteRTLM comes BEFORE embed
        if (liteRTLMPos < embedPos) {
          // Remove the LiteRTLM line
          content = content.replace(liteRTLMMatch[0] + '\n', '');
          // Re-find embed position (shifted after removal)
          var embedMatchNew = content.match(embedRegex);
          if (embedMatchNew) {
            var embedPosNew = content.indexOf(embedMatchNew[0]);
            var insertAfter = embedPosNew + embedMatchNew[0].length;
            content = content.slice(0, insertAfter) + '\n' + liteRTLMMatch[0] + content.slice(insertAfter);
          }

          fs.writeFileSync(pbxprojPath, content);
          console.log('[LiteRTLM] Reordered: re-sign phase now runs AFTER embed');
        } else {
          console.log('[LiteRTLM] Phase ordering is correct (re-sign after embed)');
        }
      } else {
        console.log('[LiteRTLM] Could not find phases to reorder (this is OK if first build)');
      }

      return cfg;
    },
  ]);

  return config;
}

module.exports = withResignCLiteRTLM;
