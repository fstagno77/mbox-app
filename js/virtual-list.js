/* Virtual scrolling for the sidebar email list */
var VirtualList = (function () {
    'use strict';

    var HEIGHTS = {
        'source-header': 60,
        'group-header': 40,
        'email-item': 72
    };
    var BUFFER = 10;

    function VList(container, scrollContainer, renderCallbacks) {
        this._container = container;          // #groups-list — holds positioned items
        this._scroll = scrollContainer;        // .sidebar — the scrollable element
        this._render = renderCallbacks;        // { sourceHeader, groupHeader, emailItem }
        this._flatItems = [];
        this._totalHeight = 0;
        this._rendered = {};                   // key → DOM node currently in the container
        this._raf = null;
        this._searchBarHeight = 0;

        var self = this;
        this._onScroll = function () {
            if (!self._raf) {
                self._raf = requestAnimationFrame(function () {
                    self._raf = null;
                    self._update();
                });
            }
        };
        this._scroll.addEventListener('scroll', this._onScroll, { passive: true });
    }

    VList.prototype.setData = function (flatItems) {
        this._flatItems = flatItems;

        // Calculate total height and store offsets
        var offset = 0;
        for (var i = 0; i < flatItems.length; i++) {
            flatItems[i]._offset = offset;
            flatItems[i]._height = HEIGHTS[flatItems[i].type] || 72;
            offset += flatItems[i]._height;
        }
        this._totalHeight = offset;
        this._container.style.position = 'relative';
        this._container.style.height = this._totalHeight + 'px';

        // Measure the search bar height (sticky at top of sidebar)
        var searchBar = this._scroll.querySelector('.sidebar-search');
        this._searchBarHeight = searchBar ? searchBar.offsetHeight : 0;

        // Clear all previously rendered DOM nodes — their offsets are stale
        // because the flat array has changed (accordion toggle, new data, etc.)
        var keys = Object.keys(this._rendered);
        for (var k = 0; k < keys.length; k++) {
            this._container.removeChild(this._rendered[keys[k]]);
        }
        this._rendered = {};

        this._update();
    };

    VList.prototype._update = function () {
        var scrollTop = this._scroll.scrollTop - this._searchBarHeight;
        if (scrollTop < 0) scrollTop = 0;
        var viewportHeight = this._scroll.clientHeight;
        var items = this._flatItems;

        // Find the range of visible items
        var startIdx = this._findIndex(scrollTop) - BUFFER;
        var endIdx = this._findIndex(scrollTop + viewportHeight) + BUFFER;
        if (startIdx < 0) startIdx = 0;
        if (endIdx >= items.length) endIdx = items.length - 1;

        // Build set of keys that should be visible
        var visibleKeys = {};
        for (var i = startIdx; i <= endIdx; i++) {
            visibleKeys[items[i]._key] = i;
        }

        // Remove items no longer visible
        var rendered = this._rendered;
        var keys = Object.keys(rendered);
        for (var k = 0; k < keys.length; k++) {
            if (!(keys[k] in visibleKeys)) {
                this._container.removeChild(rendered[keys[k]]);
                delete rendered[keys[k]];
            }
        }

        // Add newly visible items
        for (i = startIdx; i <= endIdx; i++) {
            var item = items[i];
            if (rendered[item._key]) continue;

            var el;
            if (item.type === 'source-header') {
                el = this._render.sourceHeader(item);
            } else if (item.type === 'group-header') {
                el = this._render.groupHeader(item);
            } else {
                el = this._render.emailItem(item);
            }

            el.style.position = 'absolute';
            el.style.top = item._offset + 'px';
            el.style.left = '0';
            el.style.right = '0';
            el.style.height = item._height + 'px';
            el.style.overflow = 'hidden';
            rendered[item._key] = el;
            this._container.appendChild(el);
        }
    };

    VList.prototype._findIndex = function (offset) {
        // Binary search for the item at a given scroll offset
        var items = this._flatItems;
        var lo = 0, hi = items.length - 1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (items[mid]._offset + items[mid]._height <= offset) {
                lo = mid + 1;
            } else if (items[mid]._offset > offset) {
                hi = mid - 1;
            } else {
                return mid;
            }
        }
        return lo;
    };

    VList.prototype.refresh = function () {
        // Clear all rendered items and re-render
        var keys = Object.keys(this._rendered);
        for (var i = 0; i < keys.length; i++) {
            this._container.removeChild(this._rendered[keys[i]]);
        }
        this._rendered = {};
        this._update();
    };

    VList.prototype.destroy = function () {
        this._scroll.removeEventListener('scroll', this._onScroll);
        if (this._raf) cancelAnimationFrame(this._raf);
        this._container.innerHTML = '';
        this._flatItems = [];
        this._rendered = {};
    };

    return VList;
})();
