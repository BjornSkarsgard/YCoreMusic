/* Native WebKit request identification, as required for an embedded API client.
 * No proxy, media interception, authorization changes or modification of video.
 */
#include <webkit2/webkit-web-extension.h>
#include <string.h>

static gchar *app_referer;

static void notify_view(WebKitWebPage *page, const gchar *name) {
    WebKitUserMessage *message = webkit_user_message_new(name, NULL);
    g_object_ref_sink(message);
    webkit_web_page_send_message_to_view(page, message, NULL, NULL, NULL);
    g_object_unref(message);
}

static gboolean send_request(WebKitWebPage *page, WebKitURIRequest *request,
                             WebKitURIResponse *redirect, gpointer data) {
    (void)redirect;
    (void)data;
    const gchar *page_uri = webkit_web_page_get_uri(page);
    const gchar *uri = webkit_uri_request_get_uri(request);
    const gchar *prefix = "tauri://localhost";
    const gboolean own_page = page_uri && g_str_has_prefix(page_uri, prefix)
        && (page_uri[strlen(prefix)] == '/' || page_uri[strlen(prefix)] == '\0');
    if (app_referer && own_page
        && uri && g_str_has_prefix(uri, "https://www.youtube.com/embed/")) {
        SoupMessageHeaders *headers = webkit_uri_request_get_http_headers(request);
        if (headers) {
            soup_message_headers_replace(headers, "Referer", app_referer);
            notify_view(page, "ycore-embed-identity-applied");
        }
    }
    return FALSE;
}

static void page_created(WebKitWebExtension *extension, WebKitWebPage *page, gpointer data) {
    (void)extension;
    (void)data;
    g_signal_connect(page, "send-request", G_CALLBACK(send_request), NULL);
    notify_view(page, "ycore-embed-identity-loaded");
}

G_MODULE_EXPORT void webkit_web_extension_initialize_with_user_data(
        WebKitWebExtension *extension, GVariant *user_data) {
    (void)user_data;
    const gchar *identifier = YCORE_APP_ID;
    if (!identifier || !*identifier || strlen(identifier) > 128) return;
    for (const gchar *p = identifier; *p; p++) {
        if (!g_ascii_isalnum(*p) && *p != '.' && *p != '-') return;
    }
    app_referer = g_strdup_printf("https://%s/", identifier);
    g_signal_connect(extension, "page-created", G_CALLBACK(page_created), NULL);
}
