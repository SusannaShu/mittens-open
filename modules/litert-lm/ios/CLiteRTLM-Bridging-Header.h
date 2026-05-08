/**
 * Bridging header to import the LiteRT-LM C API into Swift.
 *
 * Uses the prebuilt CLiteRTLM.xcframework from the LiteRTLM-Swift community package.
 * The framework exposes engine.h with the full C API for engine management,
 * session/conversation creation, and text/vision/audio generation.
 */

#ifndef CLiteRTLM_Bridging_Header_h
#define CLiteRTLM_Bridging_Header_h

#import <CLiteRTLM/engine.h>

#endif /* CLiteRTLM_Bridging_Header_h */
