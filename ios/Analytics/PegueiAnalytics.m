#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Events (see PegueiAnalytics.swift) plus one method: getDeviceStatus, read
// by src/analytics/deviceStatus.ts for the fishing session metrics.
@interface RCT_EXTERN_MODULE(PegueiAnalytics, RCTEventEmitter)

RCT_EXTERN_METHOD(getDeviceStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
