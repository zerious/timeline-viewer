'use strict';

if (location.hash) {
  location.replace(location.href.replace('#', '?'));
}

// eslint-disable-next-line no-unused-vars
class Viewer {
  constructor() {
    this.params = new URL(location.href).searchParams;
    this.syncView = new SyncView();
    this.timelineURL = this.params.get('loadTimelineFromURL');
    this.timelineId = null;
    this.timelineProvider = 'url';

    this.totalSize = 50 * 1000 * 1000;
    this.loadingStarted = false;
    this.refreshPage = false;
    // remote location of devtools we're using
    this.devtoolsBase = document.getElementById('devtoolsscript').src.replace(/inspector\.js.*/, '');
    this.devTools = new DevTools({viewerInstance: this});

    if (!this.timelineURL || this.startSplitViewIfNeeded(this.timelineURL)) {
      this.splitViewContainer = document.getElementById('split-view-container');
      this.isSplitView = this.splitViewContainer ? true : false;
      this.handleDragEvents();
    }
    this.devTools.init();
    this.makeDevToolsVisible(true);
  }

  dragover(e) {
    e.stopPropagation();
    e.preventDefault();
    this.makeDevToolsVisible(true);
  }

  startSplitViewIfNeeded(urls) {
    urls = urls.split(',');

    if (urls.length > 1) {
      const frameset = document.createElement('frameset');
      frameset.setAttribute('id', 'split-view-container');
      frameset.setAttribute('rows', new Array(urls.length).fill(`${100/2}%`).join(','));

      urls.forEach((url, index) => {
        const frame = document.createElement('frame');
        frame.setAttribute('id', `split-view-${index}`);
        frame.setAttribute('src', `timeline.html#loadTimelineFromURL=${url.trim()}`);
        frameset.appendChild(frame);
      });
      document.body.appendChild(frameset);
      document.documentElement.classList.add('fullbleed');
      document.querySelector('.welcome').remove();
      document.querySelector('.top-message-container').remove();
      return true;
    }
    return false;
  }

  makeDevToolsVisible(bool) {
    document.documentElement.classList[bool ? 'remove' : 'add']('hide-devtools');
  }

  loadResource(requestedURL) {
    return this.loadResourcePromise(requestedURL)
      .then(resp => {
        this.devTools.monkeyPatchingHandleDrop();
        return resp;
      });
  }

  // monkeyPatched method for devtools
  loadResourcePromise(requestedURL) {
    const url = new URL(requestedURL, location.href);
    const URLofViewer = new URL(location.href);

    // hosted devtools gets confused
    // if DevTools is requesting a file thats on our origin, we'll redirect it to devtoolsBase
    if (url && url.origin === URLofViewer.origin && (requestedURL !== this.timelineURL)) {
      const relativeUrl = url.pathname.replace(URLofViewer.pathname, '').replace(/^\//, '');
      const redirectedURL = new URL(relativeUrl, this.devtoolsBase);
      return this._orig_loadResourcePromise(redirectedURL.toString());
    }

    // pass through URLs that aren't our timelineURL param
    if (requestedURL !== this.timelineURL) {
      return this._orig_loadResourcePromise(url);
    }

    return this.fetchTimelineAsset(url.href);
  }

  fetchTimelineAsset(url) {
    this.netReqMuted = false;
    this.loadingStarted = false;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status === 200 || xhr.status === 304) {
            resolve(xhr.responseText);
          }
        }
      };
      xhr.onerror = event => {
        window.xhrEvent = event;
        this.showPanel(panel => {
          window.timelinePanel = panel;
        });
      };
      xhr.onprogress = this.updateProgress.bind(this);
      xhr.open('GET', url);
      xhr.send();
    });
  }

  showPanel(fn) {
    try {
      UI.inspectorView.showPanel('timeline').then(_ => {
        const panel = Timeline.TimelinePanel.instance();
        fn.call(this, panel);
      });
    } catch (e) {}
  }

  updateProgress(evt) {
    this.showPanel(panel => {
      // start progress
      if (!this.loadingStarted) {
        this.loadingStarted = true;
        panel && panel.loadingStarted();
      }

      // update progress
      panel && panel.loadingProgress(evt.loaded / (evt.total || this.totalSize));

      // flip off filmstrip or network if theres no data in the trace
      if (!this.netReqMuted) {
        this.netReqMuted = true;
        this.devTools.monkeyPatchSetMarkers();
      }
    });
  }
}
