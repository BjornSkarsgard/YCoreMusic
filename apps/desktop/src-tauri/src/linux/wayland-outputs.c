/* Read-only compositor output metadata. No surfaces or output configuration. */
#include <wayland-client.h>
#include "xdg-output-client.h"
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <errno.h>

struct output {
    struct wl_output *wl;
    struct zxdg_output_v1 *xdg;
    int x, y, width, height, hz;
    char name[256], make[128], model[128];
};
struct inventory {
    struct wl_display *display;
    struct zxdg_output_manager_v1 *manager;
    struct output outputs[32];
    int count;
};
static void geometry(void *data, struct wl_output *wl, int32_t x, int32_t y,
    int32_t pw, int32_t ph, int32_t subpixel, const char *make,
    const char *model, int32_t transform) {
    (void)wl; (void)x; (void)y; (void)pw; (void)ph; (void)subpixel; (void)transform;
    struct output *o = data;
    snprintf(o->make, sizeof o->make, "%s", make);
    snprintf(o->model, sizeof o->model, "%s", model);
}
static void mode(void *data, struct wl_output *wl, uint32_t flags,
    int32_t w, int32_t h, int32_t refresh) {
    (void)wl; (void)w; (void)h;
    if (flags & WL_OUTPUT_MODE_CURRENT) ((struct output *)data)->hz = (refresh + 500) / 1000;
}
static void done(void *data, struct wl_output *wl) { (void)data; (void)wl; }
static void scale(void *data, struct wl_output *wl, int32_t factor) { (void)data; (void)wl; (void)factor; }
static void name(void *data, struct wl_output *wl, const char *value) { (void)wl; struct output *o=data; snprintf(o->name,sizeof o->name,"%s",value); }
static void description(void *data, struct wl_output *wl, const char *value) { (void)data; (void)wl; (void)value; }
static const struct wl_output_listener output_listener = {geometry,mode,done,scale,name,description};
static void logical_position(void *data, struct zxdg_output_v1 *xdg, int32_t x, int32_t y) { (void)xdg; struct output *o=data; o->x=x; o->y=y; }
static void logical_size(void *data, struct zxdg_output_v1 *xdg, int32_t w, int32_t h) { (void)xdg; struct output *o=data; o->width=w; o->height=h; }
static void xdg_done(void *data, struct zxdg_output_v1 *xdg) { (void)data; (void)xdg; }
static void xdg_name(void *data, struct zxdg_output_v1 *xdg, const char *value) { (void)xdg; struct output *o=data; snprintf(o->name,sizeof o->name,"%s",value); }
static void xdg_description(void *data, struct zxdg_output_v1 *xdg, const char *value) { (void)data; (void)xdg; (void)value; }
static const struct zxdg_output_v1_listener xdg_listener = {logical_position,logical_size,xdg_done,xdg_name,xdg_description};
static void global(void *data, struct wl_registry *registry, uint32_t id, const char *interface, uint32_t version) {
    struct inventory *i=data;
    if (!strcmp(interface,"wl_output") && version >= 2 && i->count < 32) {
        struct output *o=&i->outputs[i->count++];
        o->wl=wl_registry_bind(registry,id,&wl_output_interface,version<4?version:4);
        wl_output_add_listener(o->wl,&output_listener,o);
    } else if (!strcmp(interface,"zxdg_output_manager_v1") && version >= 2) {
        i->manager=wl_registry_bind(registry,id,&zxdg_output_manager_v1_interface,version<3?version:3);
    }
}
static void removed(void *data, struct wl_registry *registry, uint32_t id) { (void)data; (void)registry; (void)id; }
static const struct wl_registry_listener registry_listener = {global,removed};
static int64_t now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return (int64_t)t.tv_sec*1000+t.tv_nsec/1000000; }
static void synced(void *data, struct wl_callback *callback, uint32_t serial) { (void)serial; *(int *)data=1; wl_callback_destroy(callback); }
static const struct wl_callback_listener sync_listener={synced};
/* One deadline covers the whole query, including a stalled compositor. */
static int sync_until(struct wl_display *display, int64_t deadline) {
    int ready=0;
    struct wl_callback *callback=wl_display_sync(display);
    if (!callback) return 0;
    wl_callback_add_listener(callback,&sync_listener,&ready);
    while (!ready) {
        if (wl_display_dispatch_pending(display)<0) break;
        if (ready) return 1;
        if (wl_display_prepare_read(display)<0) continue;
        if (wl_display_flush(display)<0 && errno!=EAGAIN) { wl_display_cancel_read(display); break; }
        int64_t remaining=deadline-now_ms();
        struct pollfd p={wl_display_get_fd(display),POLLIN,0};
        int result=remaining>0?poll(&p,1,(int)remaining):0;
        if (result<=0) { wl_display_cancel_read(display); break; }
        if (wl_display_read_events(display)<0) break;
    }
    if (!ready) wl_callback_destroy(callback);
    return ready;
}
int ycore_wayland_output(int x,int y,int width,int height,char *identity,size_t capacity,int *hz) {
    struct inventory i={0};
    i.display=wl_display_connect(NULL);
    if (!i.display) return 0;
    struct wl_registry *registry=wl_display_get_registry(i.display);
    wl_registry_add_listener(registry,&registry_listener,&i);
    int64_t deadline=now_ms()+400;
    int found=0;
    if (!sync_until(i.display,deadline) || !i.manager) goto cleanup;
    for (int n=0;n<i.count;n++) {
        struct output *o=&i.outputs[n];
        o->xdg=zxdg_output_manager_v1_get_xdg_output(i.manager,o->wl);
        zxdg_output_v1_add_listener(o->xdg,&xdg_listener,o);
    }
    if (!sync_until(i.display,deadline)) goto cleanup;
    for (int n=0;n<i.count;n++) {
        struct output *o=&i.outputs[n];
        if (o->name[0] && o->width>0 && o->height>0 && o->x==x && o->y==y && o->width==width && o->height==height) {
            found++;
            snprintf(identity,capacity,"linux-wayland:%s:%s:%s",o->name,o->make,o->model);
            *hz=o->hz;
        }
    }
cleanup:
    for (int n=0;n<i.count;n++) {
        if (i.outputs[n].xdg) zxdg_output_v1_destroy(i.outputs[n].xdg);
        wl_output_destroy(i.outputs[n].wl);
    }
    if (i.manager) zxdg_output_manager_v1_destroy(i.manager);
    wl_registry_destroy(registry);
    wl_display_disconnect(i.display);
    return found==1;
}
