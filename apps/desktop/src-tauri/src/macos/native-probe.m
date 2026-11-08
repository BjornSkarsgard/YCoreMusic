#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <WebKit/WebKit.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>

static NSString *const PlaybackStateScript =
    @"(() => { const play = document.getElementById('play');"
    "const state = document.getElementById('status')?.textContent ?? '';"
    "return { ready: !!play && !play.disabled,"
    "status: state.slice(0,200),"
    "playing: state === 'Воспроизведение',"
    "error: state.match(/Ошибка YouTube ([0-9]+)/)?.[1] ?? '',"
    "position: Number(document.getElementById('seek')?.value ?? 0),"
    "loopback: document.getElementById('player')?.src?.startsWith('http://127.0.0.1:') ?? false,"
    "players: document.querySelectorAll('iframe').length }; })()";

static void writeReport(NSString *directory, NSString *file, NSDictionary *report) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:report options:0 error:nil];
    [json writeToFile:[directory stringByAppendingPathComponent:file] atomically:YES];
}

API_AVAILABLE(macos(13.0))
@interface YCoreMediaProbe : NSObject <SCStreamOutput, SCStreamDelegate>
@property(nonatomic, strong) WKWebView *webview;
@property(nonatomic, copy) NSString *directory;
@property(nonatomic, strong) SCStream *stream;
@property(nonatomic, copy) NSArray<NSWindow *> *mirrors;
@property(nonatomic, copy) NSArray<AVSampleBufferDisplayLayer *> *layers;
@property(nonatomic, strong) NSMutableSet<NSNumber *> *videoHashes;
@property(nonatomic) NSUInteger frames;
@property(nonatomic) NSUInteger audioBuffers;
@property(nonatomic) float peak;
@property(nonatomic) BOOL finished;
- (void)start;
- (void)waitForPlayback:(NSUInteger)remaining;
@end

@implementation YCoreMediaProbe
- (void)waitForPlayback:(NSUInteger)remaining {
    [self.webview evaluateJavaScript:PlaybackStateScript completionHandler:^(id value, NSError *error) {
        NSDictionary *state = [value isKindOfClass:NSDictionary.class] ? value : @{};
        if ([state[@"playing"] boolValue] && [state[@"players"] integerValue] == 1 &&
            [state[@"position"] doubleValue] >= 1) {
            [self start];
        } else if (remaining == 0 || [state[@"error"] length] > 0) {
            [self finish:@"real_clip_not_playing"];
        } else {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC),
                dispatch_get_main_queue(), ^{ [self waitForPlayback:remaining - 1]; });
        }
    }];
}

- (void)finish:(NSString *)status {
    if (self.finished) return;
    self.finished = YES;
    SCStream *stream = self.stream;
    self.stream = nil;
    if (stream) [stream stopCaptureWithCompletionHandler:nil];
    for (NSWindow *window in self.mirrors) [window close];
    self.mirrors = nil;
    self.layers = nil;
    writeReport(self.directory, @"media.json", @{
        @"status": status,
        @"frames": @(self.frames),
        @"uniqueCenterFrames": @(self.videoHashes.count),
        @"audioBuffers": @(self.audioBuffers),
        @"audioPeak": @(self.peak)
    });
}

- (void)openMirrors {
    NSArray<NSScreen *> *screens = NSScreen.screens;
    if (screens.count == 0) return;
    NSMutableArray *windows = [NSMutableArray array];
    NSMutableArray *layers = [NSMutableArray array];
    for (NSUInteger index = 0; index < 2; index++) {
        NSScreen *screen = screens[MIN(index, screens.count - 1)];
        NSRect frame = screen.visibleFrame;
        NSRect rect = NSMakeRect(NSMinX(frame) + 30 + index * 340,
                                  NSMinY(frame) + 50, 320, 180);
        NSWindow *window = [[NSWindow alloc] initWithContentRect:rect
            styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        window.releasedWhenClosed = NO;
        window.title = [NSString stringWithFormat:@"YCore mirror %lu", (unsigned long)index + 1];
        NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 320, 180)];
        view.wantsLayer = YES;
        AVSampleBufferDisplayLayer *layer = [AVSampleBufferDisplayLayer layer];
        layer.videoGravity = AVLayerVideoGravityResizeAspect;
        layer.frame = view.bounds;
        [view.layer addSublayer:layer];
        window.contentView = view;
        [window orderFrontRegardless];
        [windows addObject:window];
        [layers addObject:layer];
    }
    self.mirrors = windows;
    self.layers = layers;
}

- (void)start {
    self.videoHashes = [NSMutableSet set];
    // The permission prompt is only requested in the explicit manual run.
    if (!CGPreflightScreenCaptureAccess()) {
        if ([NSProcessInfo.processInfo.environment[@"YCORE_MACOS_REQUEST_CAPTURE"] isEqual:@"1"])
            CGRequestScreenCaptureAccess();
        [self finish:@"screen_recording_permission_required"];
        return;
    }
    NSWindow *source = self.webview.window;
    if (!source || source.windowNumber <= 0) {
        [self finish:@"source_window_unavailable"];
        return;
    }
    CGWindowID sourceID = (CGWindowID)source.windowNumber;
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO
        completionHandler:^(SCShareableContent *content, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (self.finished) return;
            if (error) { [self finish:@"shareable_content_failed"]; return; }
            SCWindow *ownedWindow = nil;
            for (SCWindow *window in content.windows) {
                if (window.windowID == sourceID &&
                    window.owningApplication.processID == NSProcessInfo.processInfo.processIdentifier) {
                    ownedWindow = window;
                    break;
                }
            }
            if (!ownedWindow) { [self finish:@"owned_window_not_found"]; return; }
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:ownedWindow];
            SCStreamConfiguration *config = [SCStreamConfiguration new];
            config.width = 640;
            config.height = 360;
            config.queueDepth = 3;
            config.minimumFrameInterval = CMTimeMake(1, 30);
            config.showsCursor = NO;
            config.pixelFormat = kCVPixelFormatType_32BGRA;
            config.capturesAudio = YES;
            config.excludesCurrentProcessAudio = NO;
            config.sampleRate = 48000;
            config.channelCount = 2;
            if (@available(macOS 14.2, *)) config.ignoreShadowsSingleWindow = YES;
            self.stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:self];
            dispatch_queue_t queue = dispatch_get_main_queue();
            if (![self.stream addStreamOutput:self type:SCStreamOutputTypeScreen sampleHandlerQueue:queue error:nil] ||
                ![self.stream addStreamOutput:self type:SCStreamOutputTypeAudio sampleHandlerQueue:queue error:nil]) {
                [self finish:@"stream_output_failed"]; return;
            }
            [self openMirrors];
            if (self.layers.count != 2) { [self finish:@"no_display"]; return; }
            [self.stream startCaptureWithCompletionHandler:^(NSError *startError) {
                if (startError) dispatch_async(queue, ^{ [self finish:@"stream_start_failed"]; });
            }];
        });
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 12 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        [self finish:@"sampled"];
    });
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    dispatch_async(dispatch_get_main_queue(), ^{ [self finish:@"stream_stopped"]; });
}

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample
         ofType:(SCStreamOutputType)type {
    if (self.finished || !CMSampleBufferIsValid(sample)) return;
    if (type == SCStreamOutputTypeScreen) {
        CVPixelBufferRef pixels = CMSampleBufferGetImageBuffer(sample);
        if (!pixels || CVPixelBufferLockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) return;
        const uint8_t *base = CVPixelBufferGetBaseAddress(pixels);
        size_t width = CVPixelBufferGetWidth(pixels), height = CVPixelBufferGetHeight(pixels);
        size_t stride = CVPixelBufferGetBytesPerRow(pixels);
        if (base && width >= 32 && height >= 32 && stride >= width * 4) {
            uint32_t hash = 2166136261u;
            for (size_t y = height / 5; y < height / 2; y += 8)
                for (size_t x = width / 5; x < width / 2; x += 8)
                    for (size_t c = 0; c < 3; c++)
                        hash = (hash ^ base[y * stride + x * 4 + c]) * 16777619u;
            [self.videoHashes addObject:@(hash)];
            self.frames++;
        }
        CVPixelBufferUnlockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly);
        for (AVSampleBufferDisplayLayer *layer in self.layers) {
            if (layer.isReadyForMoreMediaData) [layer enqueueSampleBuffer:sample];
        }
    } else if (type == SCStreamOutputTypeAudio) {
        const AudioStreamBasicDescription *format =
            CMAudioFormatDescriptionGetStreamBasicDescription(CMSampleBufferGetFormatDescription(sample));
        if (!format || format->mFormatID != kAudioFormatLinearPCM ||
            !(format->mFormatFlags & kAudioFormatFlagIsFloat) || format->mBitsPerChannel != 32) return;
        size_t size = 0;
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, &size, NULL, 0, NULL, NULL, 0, NULL);
        if (size < sizeof(AudioBufferList) || size > 4096) return;
        AudioBufferList *list = malloc(size);
        if (!list) return;
        CMBlockBufferRef block = NULL;
        if (CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sample, NULL, list, size, NULL, NULL, 0, &block) == noErr) {
            self.audioBuffers++;
            for (UInt32 i = 0; i < list->mNumberBuffers; i++) {
                const float *samples = list->mBuffers[i].mData;
                if (!samples) continue;
                for (size_t j = 0; j < list->mBuffers[i].mDataByteSize / sizeof(float); j++)
                    if (isfinite(samples[j])) self.peak = fmaxf(self.peak, fabsf(samples[j]));
            }
        }
        if (block) CFRelease(block);
        free(list);
    }
}
@end

static void pollClip(WKWebView *view, NSString *directory, NSUInteger remaining) {
    [view evaluateJavaScript:PlaybackStateScript completionHandler:^(id value, NSError *error) {
        if ([value isKindOfClass:NSDictionary.class]) writeReport(directory, @"clip.json", value);
        if (remaining > 0) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 2),
                dispatch_get_main_queue(), ^{ pollClip(view, directory, remaining - 1); });
        }
    }];
}

static void pollPair(WKWebView *view, NSString *directory, NSUInteger remaining) {
    [view evaluateJavaScript:
        @"(() => { const button = document.getElementById('remote-pair');"
        "if (button && !window.__ycoreProbePair) {"
        "  window.__ycoreProbePair = true; button.click();"
        "  window.__TAURI_INTERNALS__.invoke('monitor_list').then(list => {"
        "    window.__ycoreProbeDisplays = { total: list.length, stable: list.filter(d => d.stable).length };"
        "  }).catch(() => { window.__ycoreProbeDisplays = null; });"
        "}"
        "return { url: document.getElementById('remote-qr')?.dataset.pairUrl ?? '',"
        "displays: window.__ycoreProbeDisplays ?? null }; })()"
        completionHandler:^(id value, NSError *error) {
        NSDictionary *state = [value isKindOfClass:NSDictionary.class] ? value : @{};
        if ([state[@"url"] length] > 0 && state[@"displays"] != nil) {
            writeReport(directory, @"pair.json", state);
            if ([NSProcessInfo.processInfo.environment[@"YCORE_MACOS_TEST_CLIP"] isEqual:@"1"]) {
                [view evaluateJavaScript:
                    @"document.getElementById('account-welcome-later')?.click();"
                    "document.getElementById('url').value = 'aqz-KE-bpKQ';"
                    "document.getElementById('load').requestSubmit();"
                    completionHandler:^(id unused, NSError *clipError) { pollClip(view, directory, 160); }];
            }
        } else if (remaining > 0) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 4),
                dispatch_get_main_queue(), ^{ pollPair(view, directory, remaining - 1); });
        } else {
            writeReport(directory, @"pair.json", @{@"error": @"remote_qr_unavailable"});
        }
    }];
}

static void pollIdentity(NSWindow *window, WKWebView *view, NSString *directory,
                         NSString *mode, NSUInteger remaining) {
    NSString *script = [mode isEqual:@"direct"]
        ? @"(() => { const v=document.querySelector('video');"
          "if(v && !v.paused && v.currentTime>1) return {status:'playing',position:v.currentTime};"
          "const data=window.ytInitialPlayerResponse?.playabilityStatus;"
          "if(data && data.status!=='OK') return {status:'youtube_error',reason:data.status};"
          "const error=document.querySelector('.ytp-error-content-wrap-reason');"
          "if(error?.textContent && error.getClientRects().length) return {status:'youtube_error',reason:error.textContent.trim()};"
          "return null; })()"
        : @"window.probeResult ?? null";
    [view evaluateJavaScript:script completionHandler:^(id value, NSError *error) {
        if ([value isKindOfClass:NSDictionary.class]) {
            writeReport(directory, @"identity.json", value);
            [window close];
        } else if (remaining > 0) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 2),
                dispatch_get_main_queue(), ^{ pollIdentity(window, view, directory, mode, remaining - 1); });
        } else {
            writeReport(directory, @"identity.json", @{@"status": @"timed_out"});
            [window close];
        }
    }];
}

static void probeNativeIdentity(NSString *directory, NSString *mode) {
    // This standalone test has no Tauri IPC. The other WKWebView never loads a
    // clip in this mode. Use the product bundle ID as documented by YouTube.
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    NSRect bounds = NSMakeRect(0, 0, 640, 360);
    WKWebView *view = [[WKWebView alloc] initWithFrame:bounds configuration:config];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:bounds
        styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    window.title = @"YCore macOS · YouTube identity probe";
    window.contentView = view;
    [window center];
    [window makeKeyAndOrderFront:nil];
    if ([mode isEqual:@"direct"]) {
        NSURL *url = [NSURL URLWithString:@"https://www.youtube.com/embed/M7lc1UVf-VE?autoplay=1&mute=1&playsinline=1"];
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
        [request setValue:@"https://io.ycore.desktop/" forHTTPHeaderField:@"Referer"];
        [view loadRequest:request];
        pollIdentity(window, view, directory, mode, 70);
        return;
    }
    BOOL loopback = [mode isEqual:@"loopback"];
    NSString *origin = [mode isEqual:@"site-base"] ? @"https://ycore-music.ru" : @"https://io.ycore.desktop";
    if (loopback) origin = NSProcessInfo.processInfo.environment[@"YCORE_MACOS_IDENTITY_LOOPBACK"];
    NSURL *baseURL = [NSURL URLWithString:[origin stringByAppendingString:@"/"]];
    NSString *html =
        @"<!doctype html><html><head><meta name='referrer' content='strict-origin-when-cross-origin'>"
        "<style>body{margin:0;background:black}</style></head><body><div id='player'></div>"
        "<script>window.onYouTubeIframeAPIReady=()=>{"
        "const clips=['M7lc1UVf-VE','aqz-KE-bpKQ','jNQXAC9IVRw']; const errors=[];"
        "new YT.Player('player',{width:640,height:360,videoId:clips.shift(),"
        "playerVars:{origin:'YCORE_TEST_ORIGIN',playsinline:1},events:{"
        "onReady:({target})=>{target.mute();target.playVideo();"
        "const timer=setInterval(()=>{if(target.getPlayerState()===1 && target.getCurrentTime()>1){"
        "clearInterval(timer);window.probeResult={status:'playing',players:document.querySelectorAll('iframe').length};"
        "}},250);},"
        "onError:({data,target})=>{errors.push(data);"
        "if([100,101,150].includes(data)&&clips.length){target.mute();target.loadVideoById(clips.shift());}"
        "else window.probeResult={status:'youtube_error',codes:errors};},"
        "onAutoplayBlocked:()=>{window.probeResult={status:'autoplay_blocked'};}"
        "}});};</script><script src='https://www.youtube.com/iframe_api'></script></body></html>";
    html = [html stringByReplacingOccurrencesOfString:@"YCORE_TEST_ORIGIN" withString:origin];
    if (loopback) {
        [html writeToFile:[directory stringByAppendingPathComponent:@"identity.html"]
               atomically:YES encoding:NSUTF8StringEncoding error:nil];
        [view loadRequest:[NSURLRequest requestWithURL:baseURL]];
    } else {
        [view loadHTMLString:html baseURL:baseURL];
    }
    pollIdentity(window, view, directory, mode, 70);
}

void ycore_macos_native_probe(void *webview, const char *directory) {
    WKWebView *view = (__bridge WKWebView *)webview;
    NSString *path = [NSString stringWithUTF8String:directory];
    NSString *identityMode = NSProcessInfo.processInfo.environment[@"YCORE_MACOS_IDENTITY_PROBE"];
    if (identityMode.length > 0) {
        probeNativeIdentity(path, identityMode);
    } else if ([NSProcessInfo.processInfo.environment[@"YCORE_MACOS_MEDIA_SPIKE"] isEqual:@"1"]) {
        if (@available(macOS 13.0, *)) {
            // Start a test clip manually in the ordinary main window before capture.
            YCoreMediaProbe *probe = [YCoreMediaProbe new];
            probe.webview = view;
            probe.directory = path;
            [probe waitForPlayback:120];
        } else {
            writeReport(path, @"media.json", @{@"status": @"macos_13_required"});
        }
    } else {
        pollPair(view, path, 160);
    }
}
