define([
        '../ThirdParty/Uri',
        '../ThirdParty/when',
        './clone',
        './combine',
        './defaultValue',
        './defined',
        './DeveloperError',
        './objectToQuery',
        './queryToObject',
        './Request',
        './RequestScheduler'
    ], function(
        Uri,
        when,
        clone,
        combine,
        defaultValue,
        defined,
        DeveloperError,
        objectToQuery,
        queryToObject,
        Request,
        RequestScheduler) {
    'use strict';

    /**
     * Requests a resource using JSONP.
     *
     * @exports loadJsonp
     *
     * @param {Resource} resource A resource describing the request
     * @param {String} callbackParameterName The name of the callback parameter
     * @returns {Promise.<Object>|undefined} a promise that will resolve to the requested data when loaded. Returns undefined if <code>request.throttle</code> is true and the request does not have high enough priority.
     *
     *
     * @example
     * // load a data asynchronously
     * Cesium.loadJsonp('some/webservice').then(function(data) {
     *     // use the loaded data
     * }).otherwise(function(error) {
     *     // an error occurred
     * });
     *
     * @see {@link http://wiki.commonjs.org/wiki/Promises/A|CommonJS Promises/A}
     */
    function loadJsonp(resource, callbackParameterName) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(resource)) {
            throw new DeveloperError('resource is required.');
        }
        //>>includeEnd('debug');

        //generate a unique function name
        var functionName;
        do {
            functionName = 'loadJsonp' + Math.random().toString().substring(2, 8);
        } while (defined(window[functionName]));

        var queryOptions;
        if (defined(resource.queryParameters)) {
            queryOptions = clone(resource.queryParameters);
        } else {
            queryOptions = {};
        }

        callbackParameterName = defaultValue(callbackParameterName, 'callback');
        queryOptions[callbackParameterName] = functionName;
        resource = resource.getDerivedResource({
            queryParameters: queryOptions
        });

        var request = resource.request;
        request = defined(request) ? request : new Request();
        request.url = resource.getUrl();
        request.requestFunction = function() {
            var deferred = when.defer();

            //assign a function with that name in the global scope
            window[functionName] = function(data) {
                deferred.resolve(data);

                try {
                    delete window[functionName];
                } catch (e) {
                    window[functionName] = undefined;
                }
            };

            loadJsonp.loadAndExecuteScript(resource.getUrl(), functionName, deferred);
            return deferred.promise;
        };

        return RequestScheduler.request(request);
    }

    // This is broken out into a separate function so that it can be mocked for testing purposes.
    loadJsonp.loadAndExecuteScript = function(url, functionName, deferred) {
        var script = document.createElement('script');
        script.async = true;
        script.src = url;

        var head = document.getElementsByTagName('head')[0];
        script.onload = function() {
            script.onload = undefined;
            head.removeChild(script);
        };
        script.onerror = function(e) {
            deferred.reject(e);
        };

        head.appendChild(script);
    };

    loadJsonp.defaultLoadAndExecuteScript = loadJsonp.loadAndExecuteScript;

    return loadJsonp;
});
