// Native test only: deterministic IFrame API behavior without network/media.
window.YT = {
  Player: class {
    constructor(id, {events}) {
      this.events = events;
      this.state = -1;
      this.position = 0;
      this.startedAt = 0;
      this.iframe = document.createElement('iframe');
      this.iframe.id = id;
      document.getElementById(id).replaceWith(this.iframe);
      queueMicrotask(() => events.onReady({target:this}));
    }
    update(state) {
      this.state = state;
      this.events.onStateChange({target:this,data:state});
    }
    cueVideoById({startSeconds}) { this.position = startSeconds; this.update(5); }
    playVideo() { this.startedAt = performance.now(); this.update(1); }
    pauseVideo() { this.position = this.getCurrentTime(); this.update(2); }
    seekTo(seconds) { this.position = seconds; this.startedAt = performance.now(); }
    setVolume() {}
    mute() {}
    unMute() {}
    getCurrentTime() { return this.position + (this.state === 1 ? (performance.now() - this.startedAt) / 1000 : 0); }
    getDuration() { return 180; }
    getPlayerState() { return this.state; }
    getPlaybackQuality() { return 'default'; }
    destroy() { this.iframe.remove(); }
  },
};
window.onYouTubeIframeAPIReady();
