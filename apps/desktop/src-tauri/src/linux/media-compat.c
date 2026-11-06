/* Official WebKit feature API is newer than the Rust GTK bindings. Resolve it
 * at runtime so older supported WebKit libraries can still load the app.
 * This changes capability negotiation, not media, DRM, cookies or requests. */
#include <dlfcn.h>
#include <stddef.h>
#include <string.h>

int ycore_webkit_configure_media(void *settings) {
    void *(*all)(void) = dlsym(RTLD_DEFAULT, "webkit_settings_get_all_features");
    size_t (*length)(void *) = dlsym(RTLD_DEFAULT, "webkit_feature_list_get_length");
    void *(*get)(void *, size_t) = dlsym(RTLD_DEFAULT, "webkit_feature_list_get");
    const char *(*identifier)(void *) = dlsym(RTLD_DEFAULT, "webkit_feature_get_identifier");
    void (*set)(void *, void *, int) = dlsym(RTLD_DEFAULT, "webkit_settings_set_feature_enabled");
    int (*enabled)(void *, void *) = dlsym(RTLD_DEFAULT, "webkit_settings_get_feature_enabled");
    void (*unref)(void *) = dlsym(RTLD_DEFAULT, "webkit_feature_list_unref");
    if (all && length && get && identifier && set && enabled && unref) {
        void *list = all();
        if (!list) return 0;
        int configured = 0;
        for (size_t i = 0; i < length(list); i++) {
            void *feature = get(list, i);
            const char *name = feature ? identifier(feature) : NULL;
            if (name && strcmp(name, "MediaCapabilities") == 0) {
                set(settings, feature, 0);
                configured = !enabled(settings, feature);
                break;
            }
        }
        unref(list);
        return configured;
    }
    /* Before the feature API this was a regular WebKitSettings property. New
     * WebKit versions retain these legacy symbols as no-ops, so prefer above. */
    void (*legacy_set)(void *, int) = dlsym(RTLD_DEFAULT, "webkit_settings_set_enable_media_capabilities");
    int (*legacy_get)(void *) = dlsym(RTLD_DEFAULT, "webkit_settings_get_enable_media_capabilities");
    if (!legacy_set || !legacy_get) return 0;
    legacy_set(settings, 0);
    return !legacy_get(settings);
}
