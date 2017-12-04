define([
    './defaultValue',
    './defined',
    './defineProperties',
    './joinUrls',
    './objectToQuery'
], function(defaultValue,
            defined,
            defineProperties,
            joinUrls,
            objectToQuery) {
    'use strict';

    function Resource(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        this.baseUrl = options.baseUrl;
        this.filePath = options.filePath;
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

        resource.baseUrl = defaultValue(options.baseUrl, resource.baseUrl);
        resource.filePath = defaultValue(options.filePath, resource.filePath);
        resource.queryParameters = defaultValue(options.queryParameters, resource.queryParameters);
        resource.headers = defaultValue(options.headers, resource.headers);
        resource.request = defaultValue(options.request, resource.request);
        resource.responseType = defaultValue(options.responseType, resource.responseType);
        resource.method = defaultValue(options.method, resource.method);
        resource.data = defaultValue(options.data, resource.data);
        resource.overrideMimeType = defaultValue(options.overrideMimeType, resource.overrideMimeType);
        resource.proxy = defaultValue(options.proxy, resource.proxy);
        resource.allowCrossOrigin = defaultValue(options.allowCrossOrigin, resource.allowCrossOrigin);

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
        var url = this.baseUrl;
        if (defined(this.filePath)) {
            url = joinUrls(url, this.filePath);
        }
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

        result.baseUrl = this.baseUrl;
        result.filePath = this.filePath;
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
