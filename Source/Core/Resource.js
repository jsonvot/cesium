define([
    './combine',
    './defaultValue',
    './defined',
    './defineProperties',
    './joinUrls',
    './objectToQuery'
], function(combine,
            defaultValue,
            defined,
            defineProperties,
            joinUrls,
            objectToQuery) {
    'use strict';

    function Resource(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        this.url = options.url;
        this.queryParameters = options.queryParameters;
        this.headers = options.headers;
        this.request = options.request;
        this.responseType = options.responseType;
        this.method = defaultValue(options.method, 'GET');
        this.data = options.data;
        this.overrideMimeType = options.overrideMimeType;
        this.proxy = options.proxy;
        this.allowCrossOrigin = defaultValue(options.allowCrossOrigin, true);

        this._retryOnError = options.retryOnError;
        this._retryAttempts = defaultValue(options.retryAttempts, 0);
        this._retryCount = 0;
    }

    Resource.prototype.getDerivedResource = function(options) {
        var resource = this.clone();

        if (defined(options.url)) {
            resource.url = joinUrls(resource.url, options.url);
        }
        if (defined(options.queryParameters)) {
            resource.queryParameters = combine(options.queryParameters, resource.queryParameters);
        }
        if (defined(options.headers)) {
            resource.headers = combine(options.headers, resource.headers);
        }
        if (defined(options.responseType)) {
            resource.responseType = options.responseType;
        }
        if (defined(options.method)) {
            resource.method = options.method;
        }
        if (defined(options.data)) {
            resource.data = options.data;
        }
        if (defined(options.overrideMimeType)) {
            resource.overrideMimeType = options.overrideMimeType;
        }
        if (defined(options.proxy)) {
            resource.proxy = options.proxy;
        }
        if (defined(options.allowCrossOrigin)) {
            resource.allowCrossOrigin = options.allowCrossOrigin;
        }

        return resource;
    };

    Resource.prototype.retryOnError = function(options) {
        if (this._retryCount > this._retryAttempts) {
            return false;
        }
        var retry = true;
        var callback = this._retryOnError;
        if (typeof callback === 'function') {
            retry = callback(this, options);
        }
        if (retry) {
            this._retryCount++;
        }
        return retry;
    };

    Resource.prototype.getUrl = function() {
        var url = this.url;
        if (defined(this.queryParameters)) {
            url = joinUrls(url, objectToQuery(this.queryParameters));
        }
        if (defined(this.proxy)) {
            url = this.proxy.getURL(url);
        }
        return url;
    };

    Resource.prototype.clone = function(result) {
        if (!defined(result)) {
            result = new Resource();
        }

        result.url = this.url;
        result.queryParameters = this.queryParameters;
        result.headers = this.headers;
        result.request = this.request;
        result.responseType = this.responseType;
        result.method = this.method;
        result.data = this.data;
        result.overrideMimeType = this.overrideMimeType;
        result.proxy = this.proxy;
        result.allowCrossOrigin = this.allowCrossOrigin;

        return result;
    };

    return Resource;
});
