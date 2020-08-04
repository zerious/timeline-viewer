'use strict';

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

    this.statusElem = document.getElementById('status');
    this.docsElem = document.getElementById('howto');

    this.utils = new Utils();
    this.devTools = new DevTools({viewerInstance: this});

    if (!this.timelineURL || this.startSplitViewIfNeeded(this.timelineURL)) {
      this.splitViewContainer = document.getElementById('split-view-container');
      this.isSplitView = this.splitViewContainer ? true : false;
      this.handleDragEvents();
    }

    // Start loading DevTools.
    this.statusElem.hidden = false;

    this.devTools.init();
    this.makeDevToolsVisible(true);
  }

  dragover(e) {
    e.stopPropagation();
    e.preventDefault();
    this.makeDevToolsVisible(true);
    UI.inspectorView.showPanel('timeline').then(_ => {
      // TODO
    });
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
        frame.setAttribute('src', `./?loadTimelineFromURL=${url.trim()}`);
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

  updateStatus(str) {
    this.statusElem.textContent = str;
  }

  loadResource(requestedURL) {
    return this.loadResourcePromise(requestedURL)
      .then(resp => {
        this.devTools.monkeyPatchingHandleDrop();
        return resp;
      });
  }

  // monkeypatched method for devtools
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

    return this.fetchTimelineAsset(url.href).then(payload => payload);
  }

  fetchTimelineAsset(url, addRequestHeaders = Function.prototype, method = 'GET', body) {
    this.netReqMuted = false;
    this.loadingStarted = false;
    return this.utils.fetch(url, {
      url, addRequestHeaders: addRequestHeaders.bind(this), method, body,
      onprogress: this.updateProgress.bind(this),
    }, true)
      .then(xhr => {
        if (this.isSplitView) {
          return this.syncView.splitViewTimelineLoaded()
            .then(_ => SyncView.synchronizeRange(SyncView.panels()[0], this.syncView))
            .then(_ => xhr.responseText);
        } else {
          return xhr.responseText;
        }
      })
      .catch(({error, xhr}) => {
        this.makeDevToolsVisible(false);
        this.updateStatus('Download of asset failed. ' + ((xhr.readyState == xhr.DONE) ? 'CORS headers likely not applied.' : ''));
        console.warn('Download of asset failed', error);
      });
  }

  updateProgress(evt) {
    try {
      UI.inspectorView.showPanel('timeline').then(_ => {
        const panel = Timeline.TimelinePanel.instance();
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
    } catch (e) {}
  }
}
