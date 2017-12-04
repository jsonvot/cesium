define([
        './clone',
        './defined',
        './DeveloperError',
        './loadText'
    ], function(
        clone,
        defined,
        DeveloperError,
        loadText) {
    'use strict';

    var defaultHeaders = {
        Accept : 'application/json,*/*;q=0.01'
    };

    // note: &#42;&#47;&#42; below is */* but that ends the comment block early
    /**
     * Asynchronously loads the given URL as JSON.  Returns a promise that will resolve to
     * a JSON object once loaded, or reject if the URL failed to load.  The data is loaded
     * using XMLHttpRequest, which means that in order to make requests to another origin,
     * the server must have Cross-Origin Resource Sharing (CORS) headers enabled. This function
     * adds 'Accept: application/json,&#42;&#47;&#42;;q=0.01' to the request headers, if not
     * already specified.
     *
     * @exports loadJson
     *
     * @param {Resource} resource A Resource describing the request
     * @returns {Promise.<Object>|undefined} a promise that will resolve to the requested data when loaded. Returns undefined if <code>request.throttle</code> is true and the request does not have high enough priority.
     *
     *
     * @example
     * Cesium.loadJson('http://someUrl.com/someJson.txt').then(function(jsonData) {
     *     // Do something with the JSON object
     * }).otherwise(function(error) {
     *     // an error occurred
     * });
     *
     * @see loadText
     * @see {@link http://www.w3.org/TR/cors/|Cross-Origin Resource Sharing}
     * @see {@link http://wiki.commonjs.org/wiki/Promises/A|CommonJS Promises/A}
     */
    function loadJson(resource) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(resource)) {
            throw new DeveloperError('resource is required.');
        }
        //>>includeEnd('debug');

        var headers = resource.headers;
        if (!defined(headers)) {
            headers = defaultHeaders;
        } else if (!defined(headers.Accept)) {
            // clone before adding the Accept header
            headers = clone(headers);
            headers.Accept = defaultHeaders.Accept;
        }
        resource = resource.getDerivedResource({
            headers: headers
        });

        var textPromise = loadText(resource);
        if (!defined(textPromise)) {
            return undefined;
        }

        return textPromise.then(function(value) {
            if (!defined(value)) {
                return;
            }
            return JSON.parse(value);
        });
    }

    return loadJson;
});
