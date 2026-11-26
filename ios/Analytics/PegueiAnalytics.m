#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Events only (see PegueiAnalytics.swift); no methods are called from JS.
@interface RCT_EXTERN_MODULE(PegueiAnalytics, RCTEventEmitter)
@end
