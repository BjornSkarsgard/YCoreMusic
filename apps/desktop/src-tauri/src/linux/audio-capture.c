/* Capture one validated sink input, never a default/system monitor or mic. */
#define _POSIX_C_SOURCE 200809L
#include <pulse/pulseaudio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef int (*stop_fn)(void *);
typedef int (*owned_fn)(uint32_t, void *);
typedef void (*pcm_fn)(const float *, size_t, void *);
struct capture {
    pa_mainloop *loop;
    pa_context *context;
    pa_stream *stream;
    stop_fn stop;
    owned_fn owned;
    pcm_fn pcm;
    void *data;
    unsigned candidates;
    uint32_t input, sink;
    char *monitor;
    int failed, selecting;
};
static double now(void) {
    struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);
    return (double)t.tv_sec+(double)t.tv_nsec/1000000000.0;
}
static int step(struct capture *c) {
    if(c->stop(c->data) || pa_mainloop_iterate(c->loop,0,NULL)<0) return 0;
    struct timespec pause={0,5000000};nanosleep(&pause,NULL);
    return pa_context_get_state(c->context)!=PA_CONTEXT_FAILED;
}
static int wait_operation(struct capture *c,pa_operation *op) {
    if(!op)return 0;
    double deadline=now()+2.0;
    while(pa_operation_get_state(op)==PA_OPERATION_RUNNING) {
        if(now()>deadline || !step(c)) {pa_operation_cancel(op);pa_operation_unref(op);return 0;}
    }
    int ok=pa_operation_get_state(op)==PA_OPERATION_DONE;
    pa_operation_unref(op);return ok;
}
static void inputs(pa_context *context,const pa_sink_input_info *info,int eol,void *data) {
    (void)context;struct capture *c=data;
    if(eol || !info || (c->selecting && info->corked))return;
    const char *text=pa_proplist_gets(info->proplist,PA_PROP_APPLICATION_PROCESS_ID);
    if(!text || !*text)return;
    char *end;unsigned long pid=strtoul(text,&end,10);
    if(*end || pid==0 || pid>UINT32_MAX || !c->owned((uint32_t)pid,c->data))return;
    c->candidates++;c->input=info->index;c->sink=info->sink;
}
static void sink_info(pa_context *context,const pa_sink_info *info,int eol,void *data) {
    (void)context;struct capture *c=data;
    if(eol || !info || !info->monitor_source_name)return;
    c->monitor=strdup(info->monitor_source_name);
}
static void read_audio(pa_stream *stream,size_t requested,void *data) {
    (void)requested;struct capture *c=data;const void *samples=NULL;size_t bytes=0;
    if(pa_stream_peek(stream,&samples,&bytes)<0) {c->failed=1;return;}
    if(!bytes)return;
    if(bytes%(sizeof(float)*2)!=0) {c->failed=1;pa_stream_drop(stream);return;}
    if(samples)c->pcm(samples,bytes/sizeof(float),c->data);
    else {
        const float silence[2048]={0};size_t remaining=bytes/sizeof(float);
        while(remaining) {size_t n=remaining>2048?2048:remaining;c->pcm(silence,n,c->data);remaining-=n;}
    }
    pa_stream_drop(stream);
}
int ycore_pulse_stream(stop_fn stop,owned_fn owned,pcm_fn pcm,void *data) {
    struct capture c={.stop=stop,.owned=owned,.pcm=pcm,.data=data,.selecting=1};int result=1;
    c.loop=pa_mainloop_new();if(!c.loop)return result;
    c.context=pa_context_new(pa_mainloop_get_api(c.loop),"YCore Music audio analysis");
    if(!c.context || pa_context_connect(c.context,NULL,PA_CONTEXT_NOAUTOSPAWN,NULL)<0)goto done;
    double deadline=now()+3.0;
    while(pa_context_get_state(c.context)!=PA_CONTEXT_READY) {
        if(now()>deadline || !step(&c))goto done;
    }
    result=2;
    if(!wait_operation(&c,pa_context_get_sink_input_info_list(c.context,inputs,&c)) || c.candidates!=1)goto done;
    c.selecting=0;
    if(!wait_operation(&c,pa_context_get_sink_info_by_index(c.context,c.sink,sink_info,&c)) || !c.monitor)goto done;
    result=3;
    const pa_sample_spec spec={.format=PA_SAMPLE_FLOAT32NE,.rate=48000,.channels=2};
    c.stream=pa_stream_new(c.context,"Own player spectrum",&spec,NULL);
    if(!c.stream || pa_stream_set_monitor_stream(c.stream,c.input)<0)goto done;
    pa_stream_set_read_callback(c.stream,read_audio,&c);
    const pa_buffer_attr attr={.maxlength=(uint32_t)-1,.tlength=(uint32_t)-1,.prebuf=(uint32_t)-1,.minreq=(uint32_t)-1,.fragsize=4096};
    /* DONT_MOVE prevents server fallback to a different source on disconnect. */
    if(pa_stream_connect_record(c.stream,c.monitor,&attr,PA_STREAM_ADJUST_LATENCY|PA_STREAM_DONT_MOVE)<0)goto done;
    deadline=now()+3.0;
    while(pa_stream_get_state(c.stream)!=PA_STREAM_READY) {
        if(now()>deadline || pa_stream_get_state(c.stream)==PA_STREAM_FAILED || !step(&c))goto done;
    }
    result=0;
    double recheck=now()+1.0;
    while(!stop(data)) {
        if(c.failed || !step(&c) || !PA_STREAM_IS_GOOD(pa_stream_get_state(c.stream))) {result=4;break;}
        if(now()>=recheck) {
            uint32_t index=c.input,sink=c.sink;c.candidates=0;
            if(!wait_operation(&c,pa_context_get_sink_input_info(c.context,index,inputs,&c))
                || c.candidates!=1 || c.input!=index || c.sink!=sink) {result=2;break;}
            recheck=now()+1.0;
        }
    }
 done:
    if(c.stream) {pa_stream_set_read_callback(c.stream,NULL,NULL);pa_stream_disconnect(c.stream);pa_stream_unref(c.stream);}
    if(c.context) {pa_context_disconnect(c.context);pa_context_unref(c.context);}
    if(c.loop)pa_mainloop_free(c.loop);
    free(c.monitor);return result;
}
