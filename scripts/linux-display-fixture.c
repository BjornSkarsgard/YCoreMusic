/* Test-only EDID on a private Xvfb server. Never part of the application. */
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/extensions/Xrandr.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    const char *private_server=getenv("ENCORE_PRIVATE_X11");
    if(!private_server || strcmp(private_server,"1"))return 2;
    Display *display=XOpenDisplay(NULL);if(!display)return 3;
    XRRScreenResources *resources=XRRGetScreenResourcesCurrent(display,DefaultRootWindow(display));
    if(!resources){XCloseDisplay(display);return 4;}
    Atom edid=XInternAtom(display,"EDID",False);
    for(int output=0;output<resources->noutput;output++) {
        unsigned char bytes[128]={0,255,255,255,255,255,255,0};
        bytes[8]=0x63;bytes[9]=0x5f;bytes[10]=1;bytes[12]=(unsigned char)(output+1);
        bytes[18]=1;bytes[19]=4;bytes[20]=0x80;
        memcpy(bytes+80,"YCore Xvfb",10);
        unsigned sum=0;for(int i=0;i<127;i++)sum+=bytes[i];bytes[127]=(unsigned char)(0-sum);
        XRRChangeOutputProperty(display,resources->outputs[output],edid,XA_INTEGER,8,PropModeReplace,bytes,128);
    }
    XSync(display,False);XRRFreeScreenResources(resources);XCloseDisplay(display);return 0;
}
