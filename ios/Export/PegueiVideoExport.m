#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PegueiVideoExport, NSObject)

RCT_EXTERN_METHOD(exportVideo:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
