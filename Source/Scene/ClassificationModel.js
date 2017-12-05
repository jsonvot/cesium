define([
        '../Core/arraySlice',
        '../Core/BoundingSphere',
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/Cartesian4',
        '../Core/Cartographic',
        '../Core/clone',
        '../Core/Color',
        '../Core/combine',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/destroyObject',
        '../Core/DeveloperError',
        '../Core/DistanceDisplayCondition',
        '../Core/FeatureDetection',
        '../Core/getAbsoluteUri',
        '../Core/getBaseUri',
        '../Core/getMagic',
        '../Core/getStringFromTypedArray',
        '../Core/IndexDatatype',
        '../Core/joinUrls',
        '../Core/loadArrayBuffer',
        '../Core/loadCRN',
        '../Core/loadImage',
        '../Core/loadImageFromTypedArray',
        '../Core/loadKTX',
        '../Core/loadText',
        '../Core/Math',
        '../Core/Matrix2',
        '../Core/Matrix3',
        '../Core/Matrix4',
        '../Core/PixelFormat',
        '../Core/PrimitiveType',
        '../Core/Quaternion',
        '../Core/Queue',
        '../Core/RuntimeError',
        '../Core/Transforms',
        '../Core/WebGLConstants',
        '../Renderer/Buffer',
        '../Renderer/BufferUsage',
        '../Renderer/DrawCommand',
        '../Renderer/Pass',
        '../Renderer/RenderState',
        '../Renderer/Sampler',
        '../Renderer/ShaderProgram',
        '../Renderer/ShaderSource',
        '../Renderer/Texture',
        '../Renderer/TextureMinificationFilter',
        '../Renderer/TextureWrap',
        '../Renderer/VertexArray',
        '../ThirdParty/GltfPipeline/addDefaults',
        '../ThirdParty/GltfPipeline/addPipelineExtras',
        '../ThirdParty/GltfPipeline/ForEach',
        '../ThirdParty/GltfPipeline/getAccessorByteStride',
        '../ThirdParty/GltfPipeline/numberOfComponentsForType',
        '../ThirdParty/GltfPipeline/parseBinaryGltf',
        '../ThirdParty/GltfPipeline/processModelMaterialsCommon',
        '../ThirdParty/GltfPipeline/processPbrMetallicRoughness',
        '../ThirdParty/GltfPipeline/updateVersion',
        '../ThirdParty/Uri',
        '../ThirdParty/when',
        './AttributeType',
        './Axis',
        './BlendingState',
        './ClassificationType',
        './ColorBlendMode',
        './DepthFunction',
        './getAttributeOrUniformBySemantic',
        './HeightReference',
        './JobType',
        './ModelAnimationCache',
        './ModelAnimationCollection',
        './ModelMaterial',
        './ModelMesh',
        './ModelNode',
        './SceneMode',
        './ShadowMode',
        './StencilFunction',
        './StencilOperation',
        './Vector3DTileBatch',
        './Vector3DTilePrimitive'
    ], function(
        arraySlice,
        BoundingSphere,
        Cartesian2,
        Cartesian3,
        Cartesian4,
        Cartographic,
        clone,
        Color,
        combine,
        defaultValue,
        defined,
        defineProperties,
        destroyObject,
        DeveloperError,
        DistanceDisplayCondition,
        FeatureDetection,
        getAbsoluteUri,
        getBaseUri,
        getMagic,
        getStringFromTypedArray,
        IndexDatatype,
        joinUrls,
        loadArrayBuffer,
        loadCRN,
        loadImage,
        loadImageFromTypedArray,
        loadKTX,
        loadText,
        CesiumMath,
        Matrix2,
        Matrix3,
        Matrix4,
        PixelFormat,
        PrimitiveType,
        Quaternion,
        Queue,
        RuntimeError,
        Transforms,
        WebGLConstants,
        Buffer,
        BufferUsage,
        DrawCommand,
        Pass,
        RenderState,
        Sampler,
        ShaderProgram,
        ShaderSource,
        Texture,
        TextureMinificationFilter,
        TextureWrap,
        VertexArray,
        addDefaults,
        addPipelineExtras,
        ForEach,
        getAccessorByteStride,
        numberOfComponentsForType,
        parseBinaryGltf,
        processModelMaterialsCommon,
        processPbrMetallicRoughness,
        updateVersion,
        Uri,
        when,
        AttributeType,
        Axis,
        BlendingState,
        ClassificationType,
        ColorBlendMode,
        DepthFunction,
        getAttributeOrUniformBySemantic,
        HeightReference,
        JobType,
        ModelAnimationCache,
        ModelAnimationCollection,
        ModelMaterial,
        ModelMesh,
        ModelNode,
        SceneMode,
        ShadowMode,
        StencilFunction,
        StencilOperation,
        Vector3DTileBatch,
        Vector3DTilePrimitive) {
    'use strict';

    // Bail out if the browser doesn't support typed arrays, to prevent the setup function
    // from failing, since we won't be able to create a WebGL context anyway.
    if (!FeatureDetection.supportsTypedArrays()) {
        return {};
    }

    var boundingSphereCartesian3Scratch = new Cartesian3();

    var ModelState = {
        NEEDS_LOAD : 0,
        LOADING : 1,
        LOADED : 2,  // Renderable, but textures can still be pending when incrementallyLoadTextures is true.
        FAILED : 3
    };

    // glTF MIME types discussed in https://github.com/KhronosGroup/glTF/issues/412 and https://github.com/KhronosGroup/glTF/issues/943
    var defaultModelAccept = 'model/gltf-binary,model/gltf+json;q=0.8,application/json;q=0.2,*/*;q=0.01';

    function LoadResources() {
        this.vertexBuffersToCreate = new Queue();
        this.indexBuffersToCreate = new Queue();
        this.buffers = {};
        this.pendingBufferLoads = 0;

        this.programsToCreate = new Queue();
        this.pendingShaderLoads = 0;

        this.createVertexArrays = true;
        this.createUniformMaps = true;
        this.createRuntimeNodes = true;

        this.skinnedNodesIds = [];
    }

    LoadResources.prototype.getBuffer = function(bufferView) {
        return getSubarray(this.buffers[bufferView.buffer], bufferView.byteOffset, bufferView.byteLength);
    };

    LoadResources.prototype.finishedPendingBufferLoads = function() {
        return (this.pendingBufferLoads === 0);
    };

    LoadResources.prototype.finishedBuffersCreation = function() {
        return ((this.pendingBufferLoads === 0) &&
                (this.vertexBuffersToCreate.length === 0) &&
                (this.indexBuffersToCreate.length === 0));
    };

    LoadResources.prototype.finishedProgramCreation = function() {
        return ((this.pendingShaderLoads === 0) && (this.programsToCreate.length === 0));
    };

    LoadResources.prototype.finishedEverythingButTextureCreation = function() {
        var finishedPendingLoads =
            (this.pendingBufferLoads === 0) &&
            (this.pendingShaderLoads === 0);
        var finishedResourceCreation =
            (this.vertexBuffersToCreate.length === 0) &&
            (this.indexBuffersToCreate.length === 0) &&
            (this.programsToCreate.length === 0);

        return finishedPendingLoads && finishedResourceCreation;
    };

    LoadResources.prototype.finished = function() {
        return this.finishedEverythingButTextureCreation();
    };

    ///////////////////////////////////////////////////////////////////////////

    function setCachedGltf(model, cachedGltf) {
        model._cachedGltf = cachedGltf;
    }

    // glTF JSON can be big given embedded geometry, textures, and animations, so we
    // cache it across all models using the same url/cache-key.  This also reduces the
    // slight overhead in assigning defaults to missing values.
    //
    // Note that this is a global cache, compared to renderer resources, which
    // are cached per context.
    function CachedGltf(options) {
        this._gltf = options.gltf;
        this.ready = options.ready;
        this.modelsToLoad = [];
        this.count = 0;
    }

    defineProperties(CachedGltf.prototype, {
        gltf : {
            set : function(value) {
                this._gltf = value;
            },

            get : function() {
                return this._gltf;
            }
        }
    });

    CachedGltf.prototype.makeReady = function(gltfJson) {
        this.gltf = gltfJson;

        var models = this.modelsToLoad;
        var length = models.length;
        for (var i = 0; i < length; ++i) {
            var m = models[i];
            if (!m.isDestroyed()) {
                setCachedGltf(m, this);
            }
        }
        this.modelsToLoad = undefined;
        this.ready = true;
    };

    var gltfCache = {};

    ///////////////////////////////////////////////////////////////////////////

    /**
     * A 3D model based on glTF, the runtime asset format for WebGL, OpenGL ES, and OpenGL.
     * <p>
     * Cesium includes support for geometry and materials, glTF animations, and glTF skinning.
     * In addition, individual glTF nodes are pickable with {@link Scene#pick} and animatable
     * with {@link Model#getNode}.  glTF cameras and lights are not currently supported.
     * </p>
     * <p>
     * An external glTF asset is created with {@link Model.fromGltf}.  glTF JSON can also be
     * created at runtime and passed to this constructor function.  In either case, the
     * {@link Model#readyPromise} is resolved when the model is ready to render, i.e.,
     * when the external binary, image, and shader files are downloaded and the WebGL
     * resources are created.
     * </p>
     * <p>
     * For high-precision rendering, Cesium supports the CESIUM_RTC extension, which introduces the
     * CESIUM_RTC_MODELVIEW parameter semantic that says the node is in WGS84 coordinates translated
     * relative to a local origin.
     * </p>
     *
     * @alias Model
     * @constructor
     *
     * @param {Object} [options] Object with the following properties:
     * @param {Object|ArrayBuffer|Uint8Array} [options.gltf] The object for the glTF JSON or an arraybuffer of Binary glTF defined by the KHR_binary_glTF extension.
     * @param {String} [options.basePath=''] The base path that paths in the glTF JSON are relative to.
     * @param {Boolean} [options.show=true] Determines if the model primitive will be shown.
     * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] The 4x4 transformation matrix that transforms the model from model to world coordinates.
     * @param {Number} [options.scale=1.0] A uniform scale applied to this model.
     * @param {Number} [options.minimumPixelSize=0.0] The approximate minimum pixel size of the model regardless of zoom.
     * @param {Number} [options.maximumScale] The maximum scale size of a model. An upper limit for minimumPixelSize.
     * @param {Object} [options.id] A user-defined object to return when the model is picked with {@link Scene#pick}.
     * @param {Boolean} [options.allowPicking=true] When <code>true</code>, each glTF mesh and primitive is pickable with {@link Scene#pick}.
     * @param {Boolean} [options.asynchronous=true] Determines if model WebGL resource creation will be spread out over several frames or block until completion once all glTF files are loaded.
     * @param {Boolean} [options.clampAnimations=true] Determines if the model's animations should hold a pose over frames where no keyframes are specified.
     * @param {Boolean} [options.debugShowBoundingVolume=false] For debugging only. Draws the bounding sphere for each draw command in the model.
     * @param {Boolean} [options.debugWireframe=false] For debugging only. Draws the model in wireframe.
     * @param {HeightReference} [options.heightReference] Determines how the model is drawn relative to terrain.
     * @param {Scene} [options.scene] Must be passed in for models that use the height reference property.
     * @param {DistanceDisplayCondition} [options.distanceDisplayCondition] The condition specifying at what distance from the camera that this model will be displayed.
     * @param {Color} [options.color=Color.WHITE] A color that blends with the model's rendered color.
     * @param {ColorBlendMode} [options.colorBlendMode=ColorBlendMode.HIGHLIGHT] Defines how the color blends with the model.
     * @param {Number} [options.colorBlendAmount=0.5] Value used to determine the color strength when the <code>colorBlendMode</code> is <code>MIX</code>. A value of 0.0 results in the model's rendered color while a value of 1.0 results in a solid color, with any value in-between resulting in a mix of the two.
     *
     * @exception {DeveloperError} bgltf is not a valid Binary glTF file.
     * @exception {DeveloperError} Only glTF Binary version 1 is supported.
     *
     * @see Model.fromGltf
     *
     * @demo {@link http://cesiumjs.org/Cesium/Apps/Sandcastle/index.html?src=3D%20Models.html|Cesium Sandcastle Models Demo}
     */
    function Model(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        var cacheKey = options.cacheKey;
        this._cacheKey = cacheKey;
        this._cachedGltf = undefined;

        var cachedGltf;
        if (defined(cacheKey) && defined(gltfCache[cacheKey]) && gltfCache[cacheKey].ready) {
            // glTF JSON is in cache and ready
            cachedGltf = gltfCache[cacheKey];
            ++cachedGltf.count;
        } else {
            // glTF was explicitly provided, e.g., when a user uses the Model constructor directly
            var gltf = options.gltf;

            if (defined(gltf)) {
                if (gltf instanceof ArrayBuffer) {
                    gltf = new Uint8Array(gltf);
                }

                if (gltf instanceof Uint8Array) {
                    // Binary glTF
                    var parsedGltf = parseBinaryGltf(gltf);

                    cachedGltf = new CachedGltf({
                        gltf : parsedGltf,
                        ready : true
                    });
                } else {
                    // Normal glTF (JSON)
                    cachedGltf = new CachedGltf({
                        gltf : options.gltf,
                        ready : true
                    });
                }

                cachedGltf.count = 1;

                if (defined(cacheKey)) {
                    gltfCache[cacheKey] = cachedGltf;
                }
            }
        }
        setCachedGltf(this, cachedGltf);

        this._basePath = defaultValue(options.basePath, '');
        var baseUri = getBaseUri(document.location.href);
        this._baseUri = joinUrls(baseUri, this._basePath);

        /**
         * Determines if the model primitive will be shown.
         *
         * @type {Boolean}
         *
         * @default true
         */
        this.show = defaultValue(options.show, true);

        this.classificationType = options.classificationType;
        this._classificationType = undefined;

        /**
         * The 4x4 transformation matrix that transforms the model from model to world coordinates.
         * When this is the identity matrix, the model is drawn in world coordinates, i.e., Earth's WGS84 coordinates.
         * Local reference frames can be used by providing a different transformation matrix, like that returned
         * by {@link Transforms.eastNorthUpToFixedFrame}.
         *
         * @type {Matrix4}
         *
         * @default {@link Matrix4.IDENTITY}
         *
         * @example
         * var origin = Cesium.Cartesian3.fromDegrees(-95.0, 40.0, 200000.0);
         * m.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
         */
        this.modelMatrix = Matrix4.clone(defaultValue(options.modelMatrix, Matrix4.IDENTITY));
        this._modelMatrix = Matrix4.clone(this.modelMatrix);
        this._clampedModelMatrix = undefined;

        /**
         * A uniform scale applied to this model before the {@link Model#modelMatrix}.
         * Values greater than <code>1.0</code> increase the size of the model; values
         * less than <code>1.0</code> decrease.
         *
         * @type {Number}
         *
         * @default 1.0
         */
        this.scale = defaultValue(options.scale, 1.0);
        this._scale = this.scale;

        /**
         * The approximate minimum pixel size of the model regardless of zoom.
         * This can be used to ensure that a model is visible even when the viewer
         * zooms out.  When <code>0.0</code>, no minimum size is enforced.
         *
         * @type {Number}
         *
         * @default 0.0
         */
        this.minimumPixelSize = defaultValue(options.minimumPixelSize, 0.0);
        this._minimumPixelSize = this.minimumPixelSize;

        /**
         * The maximum scale size for a model. This can be used to give
         * an upper limit to the {@link Model#minimumPixelSize}, ensuring that the model
         * is never an unreasonable scale.
         *
         * @type {Number}
         */
        this.maximumScale = options.maximumScale;
        this._maximumScale = this.maximumScale;

        /**
         * User-defined object returned when the model is picked.
         *
         * @type Object
         *
         * @default undefined
         *
         * @see Scene#pick
         */
        this.id = options.id;
        this._id = options.id;

        /**
         * Returns the height reference of the model
         *
         * @memberof Model.prototype
         *
         * @type {HeightReference}
         *
         * @default HeightReference.NONE
         */
        this.heightReference = defaultValue(options.heightReference, HeightReference.NONE);
        this._heightReference = this.heightReference;
        this._heightChanged = false;
        this._removeUpdateHeightCallback = undefined;
        var scene = options.scene;
        this._scene = scene;
        if (defined(scene) && defined(scene.terrainProviderChanged)) {
            this._terrainProviderChangedCallback = scene.terrainProviderChanged.addEventListener(function() {
                this._heightChanged = true;
            }, this);
        }

        /**
         * Used for picking primitives that wrap a model.
         *
         * @private
         */
        this._pickObject = options.pickObject;
        this._allowPicking = defaultValue(options.allowPicking, true);

        this._ready = false;
        this._readyPromise = when.defer();

        this._defaultTexture = undefined;
        this._incrementallyLoadTextures = defaultValue(options.incrementallyLoadTextures, true);
        this._asynchronous = defaultValue(options.asynchronous, true);

        /**
         * A color that blends with the model's rendered color.
         *
         * @type {Color}
         *
         * @default Color.WHITE
         */
        this.color = defaultValue(options.color, Color.WHITE);
        this._color = new Color();
        this._colorPreviousAlpha = 1.0;

        /**
         * Defines how the color blends with the model.
         *
         * @type {ColorBlendMode}
         *
         * @default ColorBlendMode.HIGHLIGHT
         */
        this.colorBlendMode = defaultValue(options.colorBlendMode, ColorBlendMode.HIGHLIGHT);

        /**
         * Value used to determine the color strength when the <code>colorBlendMode</code> is <code>MIX</code>.
         * A value of 0.0 results in the model's rendered color while a value of 1.0 results in a solid color, with
         * any value in-between resulting in a mix of the two.
         *
         * @type {Number}
         *
         * @default 0.5
         */
        this.colorBlendAmount = defaultValue(options.colorBlendAmount, 0.5);

        /**
         * This property is for debugging only; it is not for production use nor is it optimized.
         * <p>
         * Draws the bounding sphere for each draw command in the model.  A glTF primitive corresponds
         * to one draw command.  A glTF mesh has an array of primitives, often of length one.
         * </p>
         *
         * @type {Boolean}
         *
         * @default false
         */
        this.debugShowBoundingVolume = defaultValue(options.debugShowBoundingVolume, false);
        this._debugShowBoundingVolume = false;

        /**
         * This property is for debugging only; it is not for production use nor is it optimized.
         * <p>
         * Draws the model in wireframe.
         * </p>
         *
         * @type {Boolean}
         *
         * @default false
         */
        this.debugWireframe = defaultValue(options.debugWireframe, false);
        this._debugWireframe = false;

        this._distanceDisplayCondition = options.distanceDisplayCondition;

        // Undocumented options
        this._vertexShaderLoaded = options.vertexShaderLoaded;
        this._classificationShaderLoaded = options.classificationShaderLoaded;
        this._uniformMapLoaded = options.uniformMapLoaded;
        this._pickVertexShaderLoaded = options.pickVertexShaderLoaded;
        this._pickFragmentShaderLoaded = options.pickFragmentShaderLoaded;
        this._pickUniformMapLoaded = options.pickUniformMapLoaded;
        this._ignoreCommands = defaultValue(options.ignoreCommands, false);
        this._requestType = options.requestType;
        this._upAxis = defaultValue(options.upAxis, Axis.Y);

        /**
         * @private
         * @readonly
         */
        this.cull = defaultValue(options.cull, true);

        /**
         * @private
         * @readonly
         */
        this.opaquePass = defaultValue(options.opaquePass, Pass.OPAQUE);

        this._computedModelMatrix = new Matrix4(); // Derived from modelMatrix and scale
        this._initialRadius = undefined;           // Radius without model's scale property, model-matrix scale, animations, or skins
        this._boundingSphere = undefined;
        this._scaledBoundingSphere = new BoundingSphere();
        this._state = ModelState.NEEDS_LOAD;
        this._loadResources = undefined;

        this._mode = undefined;

        this._perNodeShowDirty = false;            // true when the Cesium API was used to change a node's show property
        this._dirty = false;                       // true when the model was transformed this frame
        this._maxDirtyNumber = 0;                  // Used in place of a dirty boolean flag to avoid an extra graph traversal

        this._runtime = {
            rootNodes : undefined,
            nodes : undefined,            // Indexed with the node property's name, i.e., glTF id
            nodesByName : undefined,      // Indexed with name property in the node
            meshesByName : undefined,     // Indexed with the name property in the mesh
            materialsByName : undefined,  // Indexed with the name property in the material
            materialsById : undefined     // Indexed with the material's property name
        };

        this._uniformMaps = {};           // Not cached since it can be targeted by glTF animation
        this._extensionsUsed = undefined;     // Cached used glTF extensions
        this._extensionsRequired = undefined; // Cached required glTF extensions
        this._quantizedUniforms = {};     // Quantized uniforms for each program for WEB3D_quantized_attributes
        this._programPrimitives = {};
        this._rendererResources = {       // Cached between models with the same url/cache-key
            buffers : {},
            vertexArrays : {},
            programs : {},
            pickPrograms : {},
            classificationPrograms : {}
        };
        this._cachedRendererResources = undefined;
        this._loadRendererResourcesFromCache = false;
        this._updatedGltfVersion = false;

        this._geometryByteLength = 0;
        this._trianglesLength = 0;

        this._nodeCommands = [];
        this._pickIds = [];

        // CESIUM_RTC extension
        this._rtcCenter = undefined;    // reference to either 3D or 2D
        this._rtcCenterEye = undefined; // in eye coordinates
        this._rtcCenter3D = undefined;  // in world coordinates
        this._rtcCenter2D = undefined;  // in projected world coordinates
    }

    defineProperties(Model.prototype, {
        /**
         * The object for the glTF JSON, including properties with default values omitted
         * from the JSON provided to this model.
         *
         * @memberof Model.prototype
         *
         * @type {Object}
         * @readonly
         *
         * @default undefined
         */
        gltf : {
            get : function() {
                return defined(this._cachedGltf) ? this._cachedGltf.gltf : undefined;
            }
        },

        /**
         * The key identifying this model in the model cache for glTF JSON, renderer resources, and animations.
         * Caching saves memory and improves loading speed when several models with the same url are created.
         * <p>
         * This key is automatically generated when the model is created with {@link Model.fromGltf}.  If the model
         * is created directly from glTF JSON using the {@link Model} constructor, this key can be manually
         * provided; otherwise, the model will not be changed.
         * </p>
         *
         * @memberof Model.prototype
         *
         * @type {String}
         * @readonly
         *
         * @private
         */
        cacheKey : {
            get : function() {
                return this._cacheKey;
            }
        },

        /**
         * The base path that paths in the glTF JSON are relative to.  The base
         * path is the same path as the path containing the .gltf file
         * minus the .gltf file, when binary, image, and shader files are
         * in the same directory as the .gltf.  When this is <code>''</code>,
         * the app's base path is used.
         *
         * @memberof Model.prototype
         *
         * @type {String}
         * @readonly
         *
         * @default ''
         */
        basePath : {
            get : function() {
                return this._basePath;
            }
        },

        /**
         * The model's bounding sphere in its local coordinate system.  This does not take into
         * account glTF animations and skins nor does it take into account {@link Model#minimumPixelSize}.
         *
         * @memberof Model.prototype
         *
         * @type {BoundingSphere}
         * @readonly
         *
         * @default undefined
         *
         * @exception {DeveloperError} The model is not loaded.  Use Model.readyPromise or wait for Model.ready to be true.
         *
         * @example
         * // Center in WGS84 coordinates
         * var center = Cesium.Matrix4.multiplyByPoint(model.modelMatrix, model.boundingSphere.center, new Cesium.Cartesian3());
         */
        boundingSphere : {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (this._state !== ModelState.LOADED) {
                    throw new DeveloperError('The model is not loaded.  Use Model.readyPromise or wait for Model.ready to be true.');
                }
                //>>includeEnd('debug');

                var modelMatrix = this.modelMatrix;
                if ((this.heightReference !== HeightReference.NONE) && this._clampedModelMatrix) {
                    modelMatrix = this._clampedModelMatrix;
                }

                var nonUniformScale = Matrix4.getScale(modelMatrix, boundingSphereCartesian3Scratch);
                var scale = defined(this.maximumScale) ? Math.min(this.maximumScale, this.scale) : this.scale;
                Cartesian3.multiplyByScalar(nonUniformScale, scale, nonUniformScale);

                var scaledBoundingSphere = this._scaledBoundingSphere;
                scaledBoundingSphere.center = Cartesian3.multiplyComponents(this._boundingSphere.center, nonUniformScale, scaledBoundingSphere.center);
                scaledBoundingSphere.radius = Cartesian3.maximumComponent(nonUniformScale) * this._initialRadius;

                if (defined(this._rtcCenter)) {
                    Cartesian3.add(this._rtcCenter, scaledBoundingSphere.center, scaledBoundingSphere.center);
                }

                return scaledBoundingSphere;
            }
        },

        /**
         * When <code>true</code>, this model is ready to render, i.e., the external binary, image,
         * and shader files were downloaded and the WebGL resources were created.  This is set to
         * <code>true</code> right before {@link Model#readyPromise} is resolved.
         *
         * @memberof Model.prototype
         *
         * @type {Boolean}
         * @readonly
         *
         * @default false
         */
        ready : {
            get : function() {
                return this._ready;
            }
        },

        /**
         * Gets the promise that will be resolved when this model is ready to render, i.e., when the external binary, image,
         * and shader files were downloaded and the WebGL resources were created.
         * <p>
         * This promise is resolved at the end of the frame before the first frame the model is rendered in.
         * </p>
         *
         * @memberof Model.prototype
         * @type {Promise.<Model>}
         * @readonly
         *
         * @example
         * // Play all animations at half-speed when the model is ready to render
         * Cesium.when(model.readyPromise).then(function(model) {
         *   model.activeAnimations.addAll({
         *     speedup : 0.5
         *   });
         * }).otherwise(function(error){
         *   window.alert(error);
         * });
         *
         * @see Model#ready
         */
        readyPromise : {
            get : function() {
                return this._readyPromise.promise;
            }
        },

        /**
         * Determines if model WebGL resource creation will be spread out over several frames or
         * block until completion once all glTF files are loaded.
         *
         * @memberof Model.prototype
         *
         * @type {Boolean}
         * @readonly
         *
         * @default true
         */
        asynchronous : {
            get : function() {
                return this._asynchronous;
            }
        },

        /**
         * When <code>true</code>, each glTF mesh and primitive is pickable with {@link Scene#pick}.  When <code>false</code>, GPU memory is saved.
         *
         * @memberof Model.prototype
         *
         * @type {Boolean}
         * @readonly
         *
         * @default true
         */
        allowPicking : {
            get : function() {
                return this._allowPicking;
            }
        },

        /**
         * Determine if textures may continue to stream in after the model is loaded.
         *
         * @memberof Model.prototype
         *
         * @type {Boolean}
         * @readonly
         *
         * @default true
         */
        incrementallyLoadTextures : {
            get : function() {
                return this._incrementallyLoadTextures;
            }
        },

        /**
         * Return the number of pending texture loads.
         *
         * @memberof Model.prototype
         *
         * @type {Number}
         * @readonly
         */
        pendingTextureLoads : {
            get : function() {
                return defined(this._loadResources) ? this._loadResources.pendingTextureLoads : 0;
            }
        },

        /**
         * Returns true if the model was transformed this frame
         *
         * @memberof Model.prototype
         *
         * @type {Boolean}
         * @readonly
         *
         * @private
         */
        dirty : {
            get : function() {
                return this._dirty;
            }
        },

        /**
         * Gets or sets the condition specifying at what distance from the camera that this model will be displayed.
         * @memberof Model.prototype
         * @type {DistanceDisplayCondition}
         * @default undefined
         */
        distanceDisplayCondition : {
            get : function() {
                return this._distanceDisplayCondition;
            },
            set : function(value) {
                //>>includeStart('debug', pragmas.debug);
                if (defined(value) && value.far <= value.near) {
                    throw new DeveloperError('far must be greater than near');
                }
                //>>includeEnd('debug');
                this._distanceDisplayCondition = DistanceDisplayCondition.clone(value, this._distanceDisplayCondition);
            }
        },

        extensionsUsed : {
            get : function() {
                if (!defined(this._extensionsUsed)) {
                    this._extensionsUsed = getUsedExtensions(this);
                }
                return this._extensionsUsed;
            }
        },

        extensionsRequired : {
            get : function() {
                if (!defined(this._extensionsRequired)) {
                    this._extensionsRequired = getRequiredExtensions(this);
                }
                return this._extensionsRequired;
            }
        },

        /**
         * Gets the model's up-axis.
         * By default models are y-up according to the glTF spec, however geo-referenced models will typically be z-up.
         *
         * @memberof Model.prototype
         *
         * @type {Number}
         * @default Axis.Y
         * @readonly
         *
         * @private
         */
        upAxis : {
            get : function() {
                return this._upAxis;
            }
        },

        /**
         * Gets the model's triangle count.
         *
         * @private
         */
        trianglesLength : {
            get : function() {
                return this._trianglesLength;
            }
        },

        /**
         * Gets the model's geometry memory in bytes. This includes all vertex and index buffers.
         *
         * @private
         */
        geometryByteLength : {
            get : function() {
                return this._geometryByteLength;
            }
        },

        /**
         * Gets the model's texture memory in bytes.
         *
         * @private
         */
        texturesByteLength : {
            get : function() {
                return this._texturesByteLength;
            }
        },

        /**
         * Gets the model's cached geometry memory in bytes. This includes all vertex and index buffers.
         *
         * @private
         */
        cachedGeometryByteLength : {
            get : function() {
                return this._cachedGeometryByteLength;
            }
        },

        /**
         * Gets the model's cached texture memory in bytes.
         *
         * @private
         */
        cachedTexturesByteLength : {
            get : function() {
                return this._cachedTexturesByteLength;
            }
        }
    });

    /**
     * This function differs from the normal subarray function
     * because it takes offset and length, rather than begin and end.
     */
    function getSubarray(array, offset, length) {
        return array.subarray(offset, offset + length);
    }

    function containsGltfMagic(uint8Array) {
        var magic = getMagic(uint8Array);
        return magic === 'glTF';
    }

    /**
     * <p>
     * Creates a model from a glTF asset.  When the model is ready to render, i.e., when the external binary, image,
     * and shader files are downloaded and the WebGL resources are created, the {@link Model#readyPromise} is resolved.
     * </p>
     * <p>
     * The model can be a traditional glTF asset with a .gltf extension or a Binary glTF using the
     * KHR_binary_glTF extension with a .glb extension.
     * </p>
     * <p>
     * For high-precision rendering, Cesium supports the CESIUM_RTC extension, which introduces the
     * CESIUM_RTC_MODELVIEW parameter semantic that says the node is in WGS84 coordinates translated
     * relative to a local origin.
     * </p>
     *
     * @param {Object} options Object with the following properties:
     * @param {String} options.url The url to the .gltf file.
     * @param {Object} [options.headers] HTTP headers to send with the request.
     * @param {String} [options.basePath] The base path that paths in the glTF JSON are relative to.
     * @param {Boolean} [options.show=true] Determines if the model primitive will be shown.
     * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] The 4x4 transformation matrix that transforms the model from model to world coordinates.
     * @param {Number} [options.scale=1.0] A uniform scale applied to this model.
     * @param {Number} [options.minimumPixelSize=0.0] The approximate minimum pixel size of the model regardless of zoom.
     * @param {Number} [options.maximumScale] The maximum scale for the model.
     * @param {Object} [options.id] A user-defined object to return when the model is picked with {@link Scene#pick}.
     * @param {Boolean} [options.allowPicking=true] When <code>true</code>, each glTF mesh and primitive is pickable with {@link Scene#pick}.
     * @param {Boolean} [options.incrementallyLoadTextures=true] Determine if textures may continue to stream in after the model is loaded.
     * @param {Boolean} [options.asynchronous=true] Determines if model WebGL resource creation will be spread out over several frames or block until completion once all glTF files are loaded.
     * @param {Boolean} [options.clampAnimations=true] Determines if the model's animations should hold a pose over frames where no keyframes are specified.
     * @param {ShadowMode} [options.shadows=ShadowMode.ENABLED] Determines whether the model casts or receives shadows from each light source.
     * @param {Boolean} [options.debugShowBoundingVolume=false] For debugging only. Draws the bounding sphere for each {@link DrawCommand} in the model.
     * @param {Boolean} [options.debugWireframe=false] For debugging only. Draws the model in wireframe.
     *
     * @returns {Model} The newly created model.
     *
     * @exception {DeveloperError} bgltf is not a valid Binary glTF file.
     * @exception {DeveloperError} Only glTF Binary version 1 is supported.
     *
     * @example
     * // Example 1. Create a model from a glTF asset
     * var model = scene.primitives.add(Cesium.Model.fromGltf({
     *   url : './duck/duck.gltf'
     * }));
     *
     * @example
     * // Example 2. Create model and provide all properties and events
     * var origin = Cesium.Cartesian3.fromDegrees(-95.0, 40.0, 200000.0);
     * var modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
     *
     * var model = scene.primitives.add(Cesium.Model.fromGltf({
     *   url : './duck/duck.gltf',
     *   show : true,                     // default
     *   modelMatrix : modelMatrix,
     *   scale : 2.0,                     // double size
     *   minimumPixelSize : 128,          // never smaller than 128 pixels
     *   maximumScale: 20000,             // never larger than 20000 * model size (overrides minimumPixelSize)
     *   allowPicking : false,            // not pickable
     *   debugShowBoundingVolume : false, // default
     *   debugWireframe : false
     * }));
     *
     * model.readyPromise.then(function(model) {
     *   // Play all animations when the model is ready to render
     *   model.activeAnimations.addAll();
     * });
     */
    Model.fromGltf = function(options) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(options) || !defined(options.url)) {
            throw new DeveloperError('options.url is required');
        }
        //>>includeEnd('debug');

        var url = options.url;
        // If no cache key is provided, use the absolute URL, since two URLs with
        // different relative paths could point to the same model.
        var cacheKey = defaultValue(options.cacheKey, getAbsoluteUri(url));
        var basePath = defaultValue(options.basePath, getBaseUri(url, true));

        options = clone(options);
        if (defined(options.basePath) && !defined(options.cacheKey)) {
            cacheKey += basePath;
        }

        options.cacheKey = cacheKey;
        options.basePath = basePath;
        var model = new Model(options);

        options.headers = defined(options.headers) ? clone(options.headers) : {};
        if (!defined(options.headers.Accept)) {
            options.headers.Accept = defaultModelAccept;
        }

        var cachedGltf = gltfCache[cacheKey];
        if (!defined(cachedGltf)) {
            cachedGltf = new CachedGltf({
                ready : false
            });
            cachedGltf.count = 1;
            cachedGltf.modelsToLoad.push(model);
            setCachedGltf(model, cachedGltf);
            gltfCache[cacheKey] = cachedGltf;

            loadArrayBuffer(url, options.headers).then(function(arrayBuffer) {
                var array = new Uint8Array(arrayBuffer);
                if (containsGltfMagic(array)) {
                    // Load binary glTF
                    var parsedGltf = parseBinaryGltf(array);
                    // KHR_binary_glTF is from the beginning of the binary section
                    cachedGltf.makeReady(parsedGltf, array);
                } else {
                    // Load text (JSON) glTF
                    var json = getStringFromTypedArray(array);
                    cachedGltf.makeReady(JSON.parse(json));
                }
            }).otherwise(getFailedLoadFunction(model, 'model', url));
        } else if (!cachedGltf.ready) {
            // Cache hit but the loadArrayBuffer() or loadText() request is still pending
            ++cachedGltf.count;
            cachedGltf.modelsToLoad.push(model);
        }
        // else if the cached glTF is defined and ready, the
        // model constructor will pick it up using the cache key.

        return model;
    };

    /**
     * For the unit tests to verify model caching.
     *
     * @private
     */
    Model._gltfCache = gltfCache;

    function getRuntime(model, runtimeName, name) {
        //>>includeStart('debug', pragmas.debug);
        if (model._state !== ModelState.LOADED) {
            throw new DeveloperError('The model is not loaded.  Use Model.readyPromise or wait for Model.ready to be true.');
        }

        if (!defined(name)) {
            throw new DeveloperError('name is required.');
        }
        //>>includeEnd('debug');

        return (model._runtime[runtimeName])[name];
    }

    /**
     * Returns the glTF node with the given <code>name</code> property.  This is used to
     * modify a node's transform for animation outside of glTF animations.
     *
     * @param {String} name The glTF name of the node.
     * @returns {ModelNode} The node or <code>undefined</code> if no node with <code>name</code> exists.
     *
     * @exception {DeveloperError} The model is not loaded.  Use Model.readyPromise or wait for Model.ready to be true.
     *
     * @example
     * // Apply non-uniform scale to node LOD3sp
     * var node = model.getNode('LOD3sp');
     * node.matrix = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(5.0, 1.0, 1.0), node.matrix);
     */
    Model.prototype.getNode = function(name) {
        var node = getRuntime(this, 'nodesByName', name);
        return defined(node) ? node.publicNode : undefined;
    };

    /**
     * Returns the glTF mesh with the given <code>name</code> property.
     *
     * @param {String} name The glTF name of the mesh.
     *
     * @returns {ModelMesh} The mesh or <code>undefined</code> if no mesh with <code>name</code> exists.
     *
     * @exception {DeveloperError} The model is not loaded.  Use Model.readyPromise or wait for Model.ready to be true.
     */
    Model.prototype.getMesh = function(name) {
        return getRuntime(this, 'meshesByName', name);
    };

    /**
     * Returns the glTF material with the given <code>name</code> property.
     *
     * @param {String} name The glTF name of the material.
     * @returns {ModelMaterial} The material or <code>undefined</code> if no material with <code>name</code> exists.
     *
     * @exception {DeveloperError} The model is not loaded.  Use Model.readyPromise or wait for Model.ready to be true.
     */
    Model.prototype.getMaterial = function(name) {
        return getRuntime(this, 'materialsByName', name);
    };

    var aMinScratch = new Cartesian3();
    var aMaxScratch = new Cartesian3();

    function getAccessorMinMax(gltf, accessorId) {
        var accessor = gltf.accessors[accessorId];
        var extensions = accessor.extensions;
        var accessorMin = accessor.min;
        var accessorMax = accessor.max;
        // If this accessor is quantized, we should use the decoded min and max
        if (defined(extensions)) {
            var quantizedAttributes = extensions.WEB3D_quantized_attributes;
            if (defined(quantizedAttributes)) {
                accessorMin = quantizedAttributes.decodedMin;
                accessorMax = quantizedAttributes.decodedMax;
            }
        }
        return {
            min : accessorMin,
            max : accessorMax
        };
    }

    function computeBoundingSphere(model) {
        var gltf = model.gltf;
        var gltfNodes = gltf.nodes;
        var gltfMeshes = gltf.meshes;
        var rootNodes = gltf.scenes[gltf.scene].nodes;
        var rootNodesLength = rootNodes.length;

        var nodeStack = [];

        var min = new Cartesian3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        var max = new Cartesian3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

        for (var i = 0; i < rootNodesLength; ++i) {
            var n = gltfNodes[rootNodes[i]];
            n._transformToRoot = getTransform(n);
            nodeStack.push(n);

            while (nodeStack.length > 0) {
                n = nodeStack.pop();
                var transformToRoot = n._transformToRoot;

                var meshId = n.mesh;
                if (defined(meshId)) {
                    var mesh = gltfMeshes[meshId];
                    var primitives = mesh.primitives;
                    var primitivesLength = primitives.length;
                    for (var m = 0; m < primitivesLength; ++m) {
                        var positionAccessor = primitives[m].attributes.POSITION;
                        if (defined(positionAccessor)) {
                            var minMax = getAccessorMinMax(gltf, positionAccessor);
                            var aMin = Cartesian3.fromArray(minMax.min, 0, aMinScratch);
                            var aMax = Cartesian3.fromArray(minMax.max, 0, aMaxScratch);
                            if (defined(min) && defined(max)) {
                                Matrix4.multiplyByPoint(transformToRoot, aMin, aMin);
                                Matrix4.multiplyByPoint(transformToRoot, aMax, aMax);
                                Cartesian3.minimumByComponent(min, aMin, min);
                                Cartesian3.maximumByComponent(max, aMax, max);
                            }
                        }
                    }
                }

                var children = n.children;
                var childrenLength = children.length;
                for (var k = 0; k < childrenLength; ++k) {
                    var child = gltfNodes[children[k]];
                    child._transformToRoot = getTransform(child);
                    Matrix4.multiplyTransformation(transformToRoot, child._transformToRoot, child._transformToRoot);
                    nodeStack.push(child);
                }
                delete n._transformToRoot;
            }
        }

        var boundingSphere = BoundingSphere.fromCornerPoints(min, max);
        if (model._upAxis === Axis.Y) {
            BoundingSphere.transformWithoutScale(boundingSphere, Axis.Y_UP_TO_Z_UP, boundingSphere);
        } else if (model._upAxis === Axis.X) {
            BoundingSphere.transformWithoutScale(boundingSphere, Axis.X_UP_TO_Z_UP, boundingSphere);
        }
        return boundingSphere;
    }

    ///////////////////////////////////////////////////////////////////////////

    function getFailedLoadFunction(model, type, path) {
        return function() {
            model._state = ModelState.FAILED;
            model._readyPromise.reject(new RuntimeError('Failed to load ' + type + ': ' + path));
        };
    }

    function addBuffersToLoadResources(model) {
        var gltf = model.gltf;
        var loadResources = model._loadResources;
        ForEach.buffer(gltf, function(buffer, id) {
            loadResources.buffers[id] = buffer.extras._pipeline.source;
        });
    }

    function bufferLoad(model, id) {
        return function(arrayBuffer) {
            var loadResources = model._loadResources;
            var buffer = new Uint8Array(arrayBuffer);
            --loadResources.pendingBufferLoads;
            model.gltf.buffers[id].extras._pipeline.source = buffer;
        };
    }

    function parseBuffers(model) {
        var loadResources = model._loadResources;
        // Iterate this way for compatibility with objects and arrays
        var buffers = model.gltf.buffers;
        for (var id in buffers) {
            if (buffers.hasOwnProperty(id)) {
                var buffer = buffers[id];
                buffer.extras = defaultValue(buffer.extras, {});
                buffer.extras._pipeline = defaultValue(buffer.extras._pipeline, {});
                if (defined(buffer.extras._pipeline.source)) {
                    loadResources.buffers[id] = buffer.extras._pipeline.source;
                } else {
                    var bufferPath = joinUrls(model._baseUri, buffer.uri);
                    ++loadResources.pendingBufferLoads;
                    loadArrayBuffer(bufferPath).then(bufferLoad(model, id)).otherwise(getFailedLoadFunction(model, 'buffer', bufferPath));
                }
            }
        }
    }

    function parseBufferViews(model) {
        var bufferViews = model.gltf.bufferViews;

        var vertexBuffersToCreate = model._loadResources.vertexBuffersToCreate;

        // Only ARRAY_BUFFER here.  ELEMENT_ARRAY_BUFFER created below.
        ForEach.bufferView(model.gltf, function(bufferView, id) {
            if (bufferView.target === WebGLConstants.ARRAY_BUFFER) {
                vertexBuffersToCreate.enqueue(id);
            }
        });

        var indexBuffersToCreate = model._loadResources.indexBuffersToCreate;
        var indexBufferIds = {};

        // The Cesium Renderer requires knowing the datatype for an index buffer
        // at creation type, which is not part of the glTF bufferview so loop
        // through glTF accessors to create the bufferview's index buffer.
        ForEach.accessor(model.gltf, function(accessor) {
            var bufferViewId = accessor.bufferView;
            var bufferView = bufferViews[bufferViewId];

            if ((bufferView.target === WebGLConstants.ELEMENT_ARRAY_BUFFER) && !defined(indexBufferIds[bufferViewId])) {
                indexBufferIds[bufferViewId] = true;
                indexBuffersToCreate.enqueue({
                    id : bufferViewId,
                    componentType : accessor.componentType
                });
            }
        });
    }

    function parsePrograms(model) {
        ForEach.program(model.gltf, function(program, id) {
            model._loadResources.programsToCreate.enqueue(id);
        });
    }

    var nodeTranslationScratch = new Cartesian3();
    var nodeQuaternionScratch = new Quaternion();
    var nodeScaleScratch = new Cartesian3();

    function getTransform(node) {
        if (defined(node.matrix)) {
            return Matrix4.fromArray(node.matrix);
        }

        return Matrix4.fromTranslationQuaternionRotationScale(
            Cartesian3.fromArray(node.translation, 0, nodeTranslationScratch),
            Quaternion.unpack(node.rotation, 0, nodeQuaternionScratch),
            Cartesian3.fromArray(node.scale, 0, nodeScaleScratch));
    }

    function parseNodes(model) {
        var runtimeNodes = {};
        var runtimeNodesByName = {};
        var skinnedNodes = [];

        var skinnedNodesIds = model._loadResources.skinnedNodesIds;

        ForEach.node(model.gltf, function(node, id) {
            var runtimeNode = {
                // Animation targets
                matrix : undefined,
                translation : undefined,
                rotation : undefined,
                scale : undefined,

                // Per-node show inherited from parent
                computedShow : true,

                // Computed transforms
                transformToRoot : new Matrix4(),
                computedMatrix : new Matrix4(),
                dirtyNumber : 0,                    // The frame this node was made dirty by an animation; for graph traversal

                // Rendering
                commands : [],                      // empty for transform, light, and camera nodes

                // Skinned node
                inverseBindMatrices : undefined,    // undefined when node is not skinned
                bindShapeMatrix : undefined,        // undefined when node is not skinned or identity
                joints : [],                        // empty when node is not skinned
                computedJointMatrices : [],         // empty when node is not skinned

                // Joint node
                jointName : node.jointName,         // undefined when node is not a joint

                weights : [],

                // Graph pointers
                children : [],                      // empty for leaf nodes
                parents : [],                       // empty for root nodes

                // Publicly-accessible ModelNode instance to modify animation targets
                publicNode : undefined
            };
            runtimeNode.publicNode = new ModelNode(model, node, runtimeNode, id, getTransform(node));

            runtimeNodes[id] = runtimeNode;
            runtimeNodesByName[node.name] = runtimeNode;

            if (defined(node.skin)) {
                skinnedNodesIds.push(id);
                skinnedNodes.push(runtimeNode);
            }
        });

        model._runtime.nodes = runtimeNodes;
        model._runtime.nodesByName = runtimeNodesByName;
        model._runtime.skinnedNodes = skinnedNodes;
    }

    function parseMaterials(model) {
        var runtimeMaterialsByName = {};
        var runtimeMaterialsById = {};
        var uniformMaps = model._uniformMaps;

        ForEach.material(model.gltf, function(material, id) {
            // Allocated now so ModelMaterial can keep a reference to it.
            uniformMaps[id] = {
                uniformMap : undefined,
                values : undefined,
                jointMatrixUniformName : undefined,
                morphWeightsUniformName : undefined
            };

            var modelMaterial = new ModelMaterial(model, material, id);
            runtimeMaterialsByName[material.name] = modelMaterial;
            runtimeMaterialsById[id] = modelMaterial;
        });

        model._runtime.materialsByName = runtimeMaterialsByName;
        model._runtime.materialsById = runtimeMaterialsById;
    }

    function parseMeshes(model) {
        var runtimeMeshesByName = {};
        var runtimeMaterialsById = model._runtime.materialsById;

        ForEach.mesh(model.gltf, function(mesh, id) {
            runtimeMeshesByName[mesh.name] = new ModelMesh(mesh, runtimeMaterialsById, id);
            if (defined(model.extensionsUsed.WEB3D_quantized_attributes)) {
                // Cache primitives according to their program
                var primitives = mesh.primitives;
                var primitivesLength = primitives.length;
                for (var i = 0; i < primitivesLength; i++) {
                    var primitive = primitives[i];
                    var programId = getProgramForPrimitive(model, primitive);
                    var programPrimitives = model._programPrimitives[programId];
                    if (!defined(programPrimitives)) {
                        programPrimitives = [];
                        model._programPrimitives[programId] = programPrimitives;
                    }
                    programPrimitives.push(primitive);
                }
            }
        });

        model._runtime.meshesByName = runtimeMeshesByName;
    }

    function getUsedExtensions(model) {
        var extensionsUsed = model.gltf.extensionsUsed;
        var cachedExtensionsUsed = {};

        if (defined(extensionsUsed)) {
            var extensionsUsedLength = extensionsUsed.length;
            for (var i = 0; i < extensionsUsedLength; i++) {
                var extension = extensionsUsed[i];
                cachedExtensionsUsed[extension] = true;
            }
        }
        return cachedExtensionsUsed;
    }

    function getRequiredExtensions(model) {
        var extensionsRequired = model.gltf.extensionsRequired;
        var cachedExtensionsRequired = {};

        if (defined(extensionsRequired)) {
            var extensionsRequiredLength = extensionsRequired.length;
            for (var i = 0; i < extensionsRequiredLength; i++) {
                var extension = extensionsRequired[i];
                cachedExtensionsRequired[extension] = true;
            }
        }

        return cachedExtensionsRequired;
    }

    function createVertexBuffer(bufferViewId, model, context) {
        var loadResources = model._loadResources;
        var bufferViews = model.gltf.bufferViews;
        var bufferView = bufferViews[bufferViewId];

        /*
        var vertexBuffer = Buffer.createVertexBuffer({
            context : context,
            typedArray : loadResources.getBuffer(bufferView),
            usage : BufferUsage.STATIC_DRAW
        });
        vertexBuffer.vertexArrayDestroyable = false;
        */
        var vertexBuffer = loadResources.getBuffer(bufferView);
        model._rendererResources.buffers[bufferViewId] = vertexBuffer;
        model._geometryByteLength += vertexBuffer.byteLength;
    }

    function createIndexBuffer(bufferViewId, componentType, model, context) {
        var loadResources = model._loadResources;
        var bufferViews = model.gltf.bufferViews;
        var bufferView = bufferViews[bufferViewId];

        /*
        var indexBuffer = Buffer.createIndexBuffer({
            context : context,
            typedArray : loadResources.getBuffer(bufferView),
            usage : BufferUsage.STATIC_DRAW,
            indexDatatype : componentType
        });
        indexBuffer.vertexArrayDestroyable = false;
        */
        var indexBuffer = {
            typedArray : loadResources.getBuffer(bufferView),
            indexDatatype : componentType
        };
        model._rendererResources.buffers[bufferViewId] = indexBuffer;
        model._geometryByteLength += indexBuffer.typedArray.byteLength;
    }

    function createBuffers(model, frameState) {
        var loadResources = model._loadResources;

        if (loadResources.pendingBufferLoads !== 0) {
            return;
        }

        var context = frameState.context;
        var vertexBuffersToCreate = loadResources.vertexBuffersToCreate;
        var indexBuffersToCreate = loadResources.indexBuffersToCreate;

        while (vertexBuffersToCreate.length > 0) {
            createVertexBuffer(vertexBuffersToCreate.dequeue(), model, context);
        }

        while (indexBuffersToCreate.length > 0) {
            var i = indexBuffersToCreate.dequeue();
            createIndexBuffer(i.id, i.componentType, model, context);
        }
    }

    function replaceAllButFirstInString(string, find, replace) {
        var index = string.indexOf(find);
        return string.replace(new RegExp(find, 'g'), function(match, offset, all) {
            return index === offset ? match : replace;
        });
    }

    function getProgramForPrimitive(model, primitive) {
        var gltf = model.gltf;
        var materialId = primitive.material;
        var material = gltf.materials[materialId];
        var techniqueId = material.technique;
        var technique = gltf.techniques[techniqueId];
        return technique.program;
    }

    function getQuantizedAttributes(model, accessorId) {
        var gltf = model.gltf;
        var accessor = gltf.accessors[accessorId];
        var extensions = accessor.extensions;
        if (defined(extensions)) {
            return extensions.WEB3D_quantized_attributes;
        }
        return undefined;
    }

    function getAttributeVariableName(model, primitive, attributeSemantic) {
        var gltf = model.gltf;
        var materialId = primitive.material;
        var material = gltf.materials[materialId];
        var techniqueId = material.technique;
        var technique = gltf.techniques[techniqueId];
        for (var parameter in technique.parameters) {
            if (technique.parameters.hasOwnProperty(parameter)) {
                var semantic = technique.parameters[parameter].semantic;
                if (semantic === attributeSemantic) {
                    var attributes = technique.attributes;
                    for (var attributeVarName in attributes) {
                        if (attributes.hasOwnProperty(attributeVarName)) {
                            var name = attributes[attributeVarName];
                            if (name === parameter) {
                                return attributeVarName;
                            }
                        }
                    }
                }
            }
        }
        return undefined;
    }

    function modifyShaderForQuantizedAttributes(shader, programName, model) {
        var quantizedUniforms = {};
        model._quantizedUniforms[programName] = quantizedUniforms;

        var primitives = model._programPrimitives[programName];
        for (var i = 0; i < primitives.length; i++) {
            var primitive = primitives[i];
            if (getProgramForPrimitive(model, primitive) === programName) {
                for (var attributeSemantic in primitive.attributes) {
                    if (primitive.attributes.hasOwnProperty(attributeSemantic)) {
                        var attributeVarName = getAttributeVariableName(model, primitive, attributeSemantic);
                        var accessorId = primitive.attributes[attributeSemantic];

                        if (attributeSemantic.charAt(0) === '_') {
                            attributeSemantic = attributeSemantic.substring(1);
                        }
                        var decodeUniformVarName = 'gltf_u_dec_' + attributeSemantic.toLowerCase();

                        var decodeUniformVarNameScale = decodeUniformVarName + '_scale';
                        var decodeUniformVarNameTranslate = decodeUniformVarName + '_translate';
                        if (!defined(quantizedUniforms[decodeUniformVarName]) && !defined(quantizedUniforms[decodeUniformVarNameScale])) {
                            var quantizedAttributes = getQuantizedAttributes(model, accessorId);
                            if (defined(quantizedAttributes)) {
                                var decodeMatrix = quantizedAttributes.decodeMatrix;
                                var newMain = 'gltf_decoded_' + attributeSemantic;
                                var decodedAttributeVarName = attributeVarName.replace('a_', 'gltf_a_dec_');
                                var size = Math.floor(Math.sqrt(decodeMatrix.length));

                                // replace usages of the original attribute with the decoded version, but not the declaration
                                shader = replaceAllButFirstInString(shader, attributeVarName, decodedAttributeVarName);
                                // declare decoded attribute
                                var variableType;
                                if (size > 2) {
                                    variableType = 'vec' + (size - 1);
                                } else {
                                    variableType = 'float';
                                }
                                shader = variableType + ' ' + decodedAttributeVarName + ';\n' + shader;
                                // splice decode function into the shader - attributes are pre-multiplied with the decode matrix
                                // uniform in the shader (32-bit floating point)
                                var decode = '';
                                if (size === 5) {
                                    // separate scale and translate since glsl doesn't have mat5
                                    shader = 'uniform mat4 ' + decodeUniformVarNameScale + ';\n' + shader;
                                    shader = 'uniform vec4 ' + decodeUniformVarNameTranslate + ';\n' + shader;
                                    decode = '\n' +
                                             'void main() {\n' +
                                             '    ' + decodedAttributeVarName + ' = ' + decodeUniformVarNameScale + ' * ' + attributeVarName + ' + ' + decodeUniformVarNameTranslate + ';\n' +
                                             '    ' + newMain + '();\n' +
                                             '}\n';

                                    quantizedUniforms[decodeUniformVarNameScale] = {mat : 4};
                                    quantizedUniforms[decodeUniformVarNameTranslate] = {vec : 4};
                                }
                                else {
                                    shader = 'uniform mat' + size + ' ' + decodeUniformVarName + ';\n' + shader;
                                    decode = '\n' +
                                             'void main() {\n' +
                                             '    ' + decodedAttributeVarName + ' = ' + variableType + '(' + decodeUniformVarName + ' * vec' + size + '(' + attributeVarName + ',1.0));\n' +
                                             '    ' + newMain + '();\n' +
                                             '}\n';

                                    quantizedUniforms[decodeUniformVarName] = {mat : size};
                                }
                                shader = ShaderSource.replaceMain(shader, newMain);
                                shader += decode;
                            }
                        }
                    }
                }
            }
        }
        // This is not needed after the program is processed, free the memory
        model._programPrimitives[programName] = undefined;
        return shader;
    }

    function modifyShader(shader, callback) {
        if (defined(callback)) {
            shader = callback(shader);
        }
        return shader;
    }

    function createProgram(id, model, context) {
        var positionName = getAttributeOrUniformBySemantic(model.gltf, 'POSITION');
        var batchIdName = getAttributeOrUniformBySemantic(model.gltf, '_BATCHID');

        var attributeLocations = {};
        attributeLocations[positionName] = 0;
        attributeLocations[batchIdName] = 1;

        var modelViewProjectionName = getAttributeOrUniformBySemantic(model.gltf, 'MODELVIEWPROJECTION');

        var uniformDecl;
        var computePosition;

        if (!defined(modelViewProjectionName)) {
            var projectionName = getAttributeOrUniformBySemantic(model.gltf, 'PROJECTION');
            var modelViewName = getAttributeOrUniformBySemantic(model.gltf, 'MODELVIEW');
            if (!defined(modelViewName)) {
                modelViewName = getAttributeOrUniformBySemantic(model.gltf, 'CESIUM_RTC_MODELVIEW');
            }

            uniformDecl =
                'uniform mat4 ' + modelViewName + ';\n' +
                'uniform mat4 ' + projectionName + ';\n';
            computePosition = '    gl_Position = ' + projectionName + ' * ' + modelViewName + ' * ' + positionName + ';\n';
        } else {
            uniformDecl = 'uniform mat4 ' + modelViewProjectionName + ';\n';
            computePosition = '    gl_Position = ' + modelViewProjectionName + ' * ' + positionName + ';\n';
        }

        var vs =
            'attribute vec4 ' + positionName + ';\n' +
            'attribute float ' + batchIdName + ';\n' +
            uniformDecl +
            'void main() {\n' +
            computePosition +
            '}\n';
        var fs =
            'void main() \n' +
            '{ \n' +
            '    gl_FragColor = vec4(1.0); \n' +
            '}';

        if (model.extensionsUsed.WEB3D_quantized_attributes) {
            vs = modifyShaderForQuantizedAttributes(vs, id, model);
        }

        var drawVS = modifyShader(vs, model._vertexShaderLoaded);
        var drawFS = modifyShader(fs, model._classificationShaderLoaded);

        /*
        model._rendererResources.programs[id] = ShaderProgram.fromCache({
            context : context,
            vertexShaderSource : drawVS,
            fragmentShaderSource : drawFS,
            attributeLocations : attributeLocations
        });
        */
        model._rendererResources.programs[id] = {
            vertexShaderSource : drawVS,
            fragmentShaderSource : drawFS,
            attributeLocations : attributeLocations
        };

        if (model.allowPicking) {
            // PERFORMANCE_IDEA: Can optimize this shader with a glTF hint. https://github.com/KhronosGroup/glTF/issues/181
            var pickVS = modifyShader(vs, model._pickVertexShaderLoaded);
            var pickFS = modifyShader(fs, model._pickFragmentShaderLoaded);

            /*
            model._rendererResources.pickPrograms[id] = ShaderProgram.fromCache({
                context : context,
                vertexShaderSource : pickVS,
                fragmentShaderSource : pickFS,
                attributeLocations : attributeLocations
            });
            */
            model._rendererResources.pickPrograms[id] = {
                vertexShaderSource : pickVS,
                fragmentShaderSource : pickFS,
                attributeLocations : attributeLocations
            };
        }
    }

    function createPrograms(model, frameState) {
        var loadResources = model._loadResources;
        var programsToCreate = loadResources.programsToCreate;

        if (loadResources.pendingShaderLoads !== 0) {
            return;
        }

        // PERFORMANCE_IDEA: this could be more fine-grained by looking
        // at the shader's bufferView's to determine the buffer dependencies.
        if (loadResources.pendingBufferLoads !== 0) {
            return;
        }

        var context = frameState.context;
        // Create all loaded programs this frame
        while (programsToCreate.length > 0) {
            createProgram(programsToCreate.dequeue(), model, context);
        }
    }

    function getAttributeLocations() {
        return {
            POSITION : 0,
            _BATCHID : 1
        };
    }

    function createVertexArrays(model, context) {
        var loadResources = model._loadResources;

        if (!loadResources.finishedBuffersCreation() || !loadResources.finishedProgramCreation()) {
            return;
        }

        if (!loadResources.createVertexArrays) {
            return;
        }
        loadResources.createVertexArrays = false;

        var rendererBuffers = model._rendererResources.buffers;
        var rendererVertexArrays = model._rendererResources.vertexArrays;
        var gltf = model.gltf;
        var accessors = gltf.accessors;
        var meshes = gltf.meshes;

        for (var meshId in meshes) {
            if (meshes.hasOwnProperty(meshId)) {
                var primitives = meshes[meshId].primitives;
                var primitivesLength = primitives.length;

                for (var i = 0; i < primitivesLength; ++i) {
                    var primitive = primitives[i];

                    // GLTF_SPEC: This does not take into account attribute arrays,
                    // indicated by when an attribute points to a parameter with a
                    // count property.
                    //
                    // https://github.com/KhronosGroup/glTF/issues/258

                    var attributeLocations = getAttributeLocations();
                    var attributeName;
                    var attributeLocation;
                    //var attributes = [];
                    var attributes = {};
                    var primitiveAttributes = primitive.attributes;
                    for (attributeName in primitiveAttributes) {
                        if (primitiveAttributes.hasOwnProperty(attributeName)) {
                            attributeLocation = attributeLocations[attributeName];
                            // Skip if the attribute is not used by the material, e.g., because the asset was exported
                            // with an attribute that wasn't used and the asset wasn't optimized.
                            if (defined(attributeLocation)) {
                                var a = accessors[primitiveAttributes[attributeName]];
                                /*
                                attributes.push({
                                    index : attributeLocation,
                                    vertexBuffer : rendererBuffers[a.bufferView],
                                    componentsPerAttribute : numberOfComponentsForType(a.type),
                                    componentDatatype : a.componentType,
                                    offsetInBytes : a.byteOffset,
                                    strideInBytes : getAccessorByteStride(gltf, a)
                                });
                                */
                                attributes[attributeName] = {
                                    index : attributeLocation,
                                    vertexBuffer : rendererBuffers[a.bufferView],
                                    componentsPerAttribute : numberOfComponentsForType(a.type),
                                    componentDatatype : a.componentType,
                                    offsetInBytes : a.byteOffset,
                                    strideInBytes : getAccessorByteStride(gltf, a)
                                };
                            }
                        }
                    }

                    var indexBuffer;
                    if (defined(primitive.indices)) {
                        var accessor = accessors[primitive.indices];
                        indexBuffer = rendererBuffers[accessor.bufferView];
                    }
                    /*
                    rendererVertexArrays[meshId + '.primitive.' + i] = new VertexArray({
                        context : context,
                        attributes : attributes,
                        indexBuffer : indexBuffer
                    });
                    */
                    rendererVertexArrays[meshId + '.primitive.' + i] = {
                        attributes : attributes,
                        indexBuffer : indexBuffer
                    };
                }
            }
        }
    }

    // This doesn't support LOCAL, which we could add if it is ever used.
    var scratchTranslationRtc = new Cartesian3();
    var gltfSemanticUniforms = {
        PROJECTION : function(uniformState, model) {
            return function() {
                return uniformState.projection;
            };
        },
        MODELVIEW : function(uniformState, model) {
            return function() {
                return uniformState.modelView;
            };
        },
        CESIUM_RTC_MODELVIEW : function(uniformState, model) {
            // CESIUM_RTC extension
            var mvRtc = new Matrix4();
            return function() {
                if (defined(model._rtcCenter)) {
                    Matrix4.getTranslation(uniformState.model, scratchTranslationRtc);
                    Cartesian3.add(scratchTranslationRtc, model._rtcCenter, scratchTranslationRtc);
                    Matrix4.multiplyByPoint(uniformState.view, scratchTranslationRtc, scratchTranslationRtc);
                    return Matrix4.setTranslation(uniformState.modelView, scratchTranslationRtc, mvRtc);
                }
                return uniformState.modelView;
            };
        },
        MODELVIEWPROJECTION : function(uniformState, model) {
            return function() {
                return uniformState.modelViewProjection;
            };
        }
    };


    function getVec4UniformFunction(value, model) {
        var that = {
            value : Cartesian4.fromArray(value),
            clone : Cartesian4.clone,
            func : function() {
                return that.value;
            }
        };
        return that;
    }

    function getMat2UniformFunction(value, model) {
        var that = {
            value : Matrix2.fromColumnMajorArray(value),
            clone : Matrix2.clone,
            func : function() {
                return that.value;
            }
        };
        return that;
    }

    function getMat3UniformFunction(value, model) {
        var that = {
            value : Matrix3.fromColumnMajorArray(value),
            clone : Matrix3.clone,
            func : function() {
                return that.value;
            }
        };
        return that;
    }

    function getMat4UniformFunction(value, model) {
        var that = {
            value : Matrix4.fromColumnMajorArray(value),
            clone : Matrix4.clone,
            func : function() {
                return that.value;
            }
        };
        return that;
    }

    var gltfUniformsFromNode = {
        PROJECTION : function(uniformState, model, runtimeNode) {
            return function() {
                return uniformState.projection;
            };
        },
        MODELVIEW : function(uniformState, model, runtimeNode) {
            var mv = new Matrix4();
            return function() {
                return Matrix4.multiplyTransformation(uniformState.view, runtimeNode.computedMatrix, mv);
            };
        },
        CESIUM_RTC_MODELVIEW : function(uniformState, model, runtimeNode) {
            // CESIUM_RTC extension
            var mvRtc = new Matrix4();
            return function() {
                Matrix4.multiplyTransformation(uniformState.view, runtimeNode.computedMatrix, mvRtc);
                return Matrix4.setTranslation(mvRtc, model._rtcCenterEye, mvRtc);
            };
        },
        MODELVIEWPROJECTION : function(uniformState, model, runtimeNode) {
            var mvp = new Matrix4();
            return function() {
                Matrix4.multiplyTransformation(uniformState.view, runtimeNode.computedMatrix, mvp);
                return Matrix4.multiply(uniformState._projection, mvp, mvp);
            };
        }
    };

    function getUniformFunctionFromSource(source, model, semantic, uniformState) {
        var runtimeNode = model._runtime.nodes[source];
        return gltfUniformsFromNode[semantic](uniformState, model, runtimeNode);
    }

    function createUniformMaps(model, context) {
        var loadResources = model._loadResources;

        if (!loadResources.finishedProgramCreation()) {
            return;
        }

        if (!loadResources.createUniformMaps) {
            return;
        }
        loadResources.createUniformMaps = false;

        var gltf = model.gltf;
        var materials = gltf.materials;
        var techniques = gltf.techniques;
        var uniformMaps = model._uniformMaps;

        for (var materialId in materials) {
            if (materials.hasOwnProperty(materialId)) {
                var material = materials[materialId];
                var technique = techniques[material.technique];
                var parameters = technique.parameters;
                var uniforms = technique.uniforms;

                var uniformMap = {};
                var uniformValues = {};

                // Uniform parameters
                for (var name in uniforms) {
                    if (uniforms.hasOwnProperty(name) && name !== 'extras') {
                        var parameterName = uniforms[name];
                        var parameter = parameters[parameterName];

                        if (!defined(parameter.semantic) || !defined(gltfUniformsFromNode[parameter.semantic])) {
                            continue;
                        }

                        if (defined(parameter.node)) {
                            uniformMap[name] = getUniformFunctionFromSource(parameter.node, model, parameter.semantic, context.uniformState);
                        } else if (defined(parameter.semantic)) {
                            uniformMap[name] = gltfSemanticUniforms[parameter.semantic](context.uniformState, model);
                        }
                    }
                }

                var u = uniformMaps[materialId];
                u.uniformMap = uniformMap;                          // uniform name -> function for the renderer
                u.values = uniformValues;                           // material parameter name -> ModelMaterial for modifying the parameter at runtime
            }
        }
    }

    function scaleFromMatrix5Array(matrix) {
        return [matrix[0], matrix[1], matrix[2], matrix[3],
                matrix[5], matrix[6], matrix[7], matrix[8],
                matrix[10], matrix[11], matrix[12], matrix[13],
                matrix[15], matrix[16], matrix[17], matrix[18]];
    }

    function translateFromMatrix5Array(matrix) {
        return [matrix[20], matrix[21], matrix[22], matrix[23]];
    }

    function createUniformsForQuantizedAttributes(model, primitive, context) {
        var gltf = model.gltf;
        var accessors = gltf.accessors;
        var programId = getProgramForPrimitive(model, primitive);
        var quantizedUniforms = model._quantizedUniforms[programId];
        var setUniforms = {};
        var uniformMap = {};

        for (var attribute in primitive.attributes) {
            if (primitive.attributes.hasOwnProperty(attribute)) {
                var accessorId = primitive.attributes[attribute];
                var a = accessors[accessorId];
                var extensions = a.extensions;

                if (attribute.charAt(0) === '_') {
                    attribute = attribute.substring(1);
                }

                if (defined(extensions)) {
                    var quantizedAttributes = extensions.WEB3D_quantized_attributes;
                    if (defined(quantizedAttributes)) {
                        var decodeMatrix = quantizedAttributes.decodeMatrix;
                        var uniformVariable = 'gltf_u_dec_' + attribute.toLowerCase();

                        switch (a.type) {
                            case AttributeType.SCALAR:
                                uniformMap[uniformVariable] = getMat2UniformFunction(decodeMatrix, model).func;
                                setUniforms[uniformVariable] = true;
                                break;
                            case AttributeType.VEC2:
                                uniformMap[uniformVariable] = getMat3UniformFunction(decodeMatrix, model).func;
                                setUniforms[uniformVariable] = true;
                                break;
                            case AttributeType.VEC3:
                                uniformMap[uniformVariable] = getMat4UniformFunction(decodeMatrix, model).func;
                                setUniforms[uniformVariable] = true;
                                break;
                            case AttributeType.VEC4:
                                // VEC4 attributes are split into scale and translate because there is no mat5 in GLSL
                                var uniformVariableScale = uniformVariable + '_scale';
                                var uniformVariableTranslate = uniformVariable + '_translate';
                                uniformMap[uniformVariableScale] = getMat4UniformFunction(scaleFromMatrix5Array(decodeMatrix), model).func;
                                uniformMap[uniformVariableTranslate] = getVec4UniformFunction(translateFromMatrix5Array(decodeMatrix), model).func;
                                setUniforms[uniformVariableScale] = true;
                                setUniforms[uniformVariableTranslate] = true;
                                break;
                        }
                    }
                }
            }
        }

        // If there are any unset quantized uniforms in this program, they should be set to the identity
        for (var quantizedUniform in quantizedUniforms) {
            if (quantizedUniforms.hasOwnProperty(quantizedUniform)) {
                if (!setUniforms[quantizedUniform]) {
                    var properties = quantizedUniforms[quantizedUniform];
                    if (defined(properties.mat)) {
                        if (properties.mat === 2) {
                            uniformMap[quantizedUniform] = getMat2UniformFunction(Matrix2.IDENTITY, model).func;
                        } else if (properties.mat === 3) {
                            uniformMap[quantizedUniform] = getMat3UniformFunction(Matrix3.IDENTITY, model).func;
                        } else if (properties.mat === 4) {
                            uniformMap[quantizedUniform] = getMat4UniformFunction(Matrix4.IDENTITY, model).func;
                        }
                    }
                    if (defined(properties.vec)) {
                        if (properties.vec === 4) {
                            uniformMap[quantizedUniform] = getVec4UniformFunction([0, 0, 0, 0], model).func;
                        }
                    }
                }
            }
        }
        return uniformMap;
    }

    function createPickColorFunction(color) {
        return function() {
            return color;
        };
    }

    function triangleCountFromPrimitiveIndices(primitive, indicesCount) {
        switch (primitive.mode) {
            case PrimitiveType.TRIANGLES:
                return (indicesCount / 3);
            case PrimitiveType.TRIANGLE_STRIP:
            case PrimitiveType.TRIANGLE_FAN:
                return Math.max(indicesCount - 2, 0);
            default:
                return 0;
        }
    }

    var stencilMask = 0x0F;
    var stencilReference = 0;

    var classificationPreloadRS = {
        colorMask : {
            red : false,
            green : false,
            blue : false,
            alpha : false
        },
        stencilTest : {
            enabled : true,
            frontFunction : StencilFunction.ALWAYS,
            frontOperation : {
                fail : StencilOperation.KEEP,
                zFail : StencilOperation.DECREMENT_WRAP,
                zPass : StencilOperation.DECREMENT_WRAP
            },
            backFunction : StencilFunction.ALWAYS,
            backOperation : {
                fail : StencilOperation.KEEP,
                zFail : StencilOperation.INCREMENT_WRAP,
                zPass : StencilOperation.INCREMENT_WRAP
            },
            reference : stencilReference,
            mask : stencilMask
        },
        depthTest : {
            enabled : false
        },
        depthMask : false
    };

    var classificationStencilRS = {
        colorMask : {
            red : false,
            green : false,
            blue : false,
            alpha : false
        },
        stencilTest : {
            enabled : true,
            frontFunction : StencilFunction.ALWAYS,
            frontOperation : {
                fail : StencilOperation.KEEP,
                zFail : StencilOperation.KEEP,
                zPass : StencilOperation.INCREMENT_WRAP
            },
            backFunction : StencilFunction.ALWAYS,
            backOperation : {
                fail : StencilOperation.KEEP,
                zFail : StencilOperation.KEEP,
                zPass : StencilOperation.DECREMENT_WRAP
            },
            reference : stencilReference,
            mask : stencilMask
        },
        depthTest : {
            enabled : true,
            func : DepthFunction.LESS_OR_EQUAL
        },
        depthMask : false
    };

    var classificationColorRS = {
        stencilTest : {
            enabled : true,
            frontFunction : StencilFunction.NOT_EQUAL,
            frontOperation : {
                fail : StencilOperation.KEEP,
                zFail : StencilOperation.KEEP,
                zPass : StencilOperation.DECREMENT_WRAP
            },
            backFunction : StencilFunction.NOT_EQUAL,
            backOperation : {
                fail : StencilOperation.KEEP,
                zFail : StencilOperation.KEEP,
                zPass : StencilOperation.DECREMENT_WRAP
            },
            reference : stencilReference,
            mask : stencilMask
        },
        depthTest : {
            enabled : false
        },
        depthMask : false,
        blending : BlendingState.ALPHA_BLEND
    };

    var pickRenderState = {
        stencilTest : {
            enabled : true,
            frontFunction : StencilFunction.NOT_EQUAL,
            frontOperation : {
                fail : StencilOperation.KEEP,
                zFail : StencilOperation.KEEP,
                zPass : StencilOperation.DECREMENT_WRAP
            },
            backFunction : StencilFunction.NOT_EQUAL,
            backOperation : {
                fail : StencilOperation.KEEP,
                zFail : StencilOperation.KEEP,
                zPass : StencilOperation.DECREMENT_WRAP
            },
            reference : stencilReference,
            mask : stencilMask
        },
        depthTest : {
            enabled : false
        },
        depthMask : false
    };

    function createCommand(model, gltfNode, runtimeNode, context, scene3DOnly) {
        var batchTable = model._batchTable;

        var nodeCommands = model._nodeCommands;
        var pickIds = model._pickIds;
        var allowPicking = model.allowPicking;
        var runtimeMeshesByName = model._runtime.meshesByName;

        var resources = model._rendererResources;
        var rendererVertexArrays = resources.vertexArrays;
        var rendererPrograms = resources.programs;
        var rendererPickPrograms = resources.pickPrograms;
        var uniformMaps = model._uniformMaps;

        var gltf = model.gltf;
        var accessors = gltf.accessors;
        var gltfMeshes = gltf.meshes;
        var techniques = gltf.techniques;
        var materials = gltf.materials;

        var id = gltfNode.mesh;
        var mesh = gltfMeshes[id];

        var primitives = mesh.primitives;
        var length = primitives.length;

        // The glTF node hierarchy is a DAG so a node can have more than one
        // parent, so a node may already have commands.  If so, append more
        // since they will have a different model matrix.

        for (var i = 0; i < length; ++i) {
            var primitive = primitives[i];
            var ix = accessors[primitive.indices];
            var material = materials[primitive.material];
            var technique = techniques[material.technique];
            var programId = technique.program;

            var boundingSphere;
            var positionAccessor = primitive.attributes.POSITION;
            if (defined(positionAccessor)) {
                var minMax = getAccessorMinMax(gltf, positionAccessor);
                boundingSphere = BoundingSphere.fromCornerPoints(Cartesian3.fromArray(minMax.min), Cartesian3.fromArray(minMax.max));
            }

            var vertexArray = rendererVertexArrays[id + '.primitive.' + i];
            var offset;
            var count;
            if (defined(ix)) {
                count = ix.count;
                offset = (ix.byteOffset / IndexDatatype.getSizeInBytes(ix.componentType));  // glTF has offset in bytes.  Cesium has offsets in indices
            }
            else {
                var positions = accessors[primitive.attributes.POSITION];
                count = positions.count;
                offset = 0;
            }

            // Update model triangle count using number of indices
            model._trianglesLength += triangleCountFromPrimitiveIndices(primitive, count);

            var uniformMap = uniformMaps[primitive.material].uniformMap;

            // Allow callback to modify the uniformMap
            if (defined(model._uniformMapLoaded)) {
                uniformMap = model._uniformMapLoaded(uniformMap, programId, runtimeNode);
            }

            // Add uniforms for decoding quantized attributes if used
            if (model.extensionsUsed.WEB3D_quantized_attributes) {
                var quantizedUniformMap = createUniformsForQuantizedAttributes(model, primitive, context);
                uniformMap = combine(uniformMap, quantizedUniformMap);
            }

            var owner = model._pickObject;
            if (!defined(owner)) {
                owner = {
                    primitive : model,
                    id : model.id,
                    node : runtimeNode.publicNode,
                    mesh : runtimeMeshesByName[mesh.name]
                };
            }

            /*
            var preloadCommand = new DrawCommand({
                boundingVolume : new BoundingSphere(), // updated in update()
                cull : model.cull,
                modelMatrix : new Matrix4(),           // computed in update()
                primitiveType : primitive.mode,
                vertexArray : vertexArray,
                count : count,
                offset : offset,
                shaderProgram : rendererPrograms[technique.program],
                uniformMap : uniformMap,
                renderState : RenderState.fromCache(classificationPreloadRS),
                owner : owner,
                pass : model.opaquePass
            });

            var stencilCommand = DrawCommand.shallowClone(preloadCommand);
            stencilCommand.renderState = RenderState.fromCache(classificationStencilRS);

            var colorCommand = DrawCommand.shallowClone(preloadCommand);
            colorCommand.renderState = RenderState.fromCache(classificationColorRS);

            var pickCommand;

            if (allowPicking) {
                var pickUniformMap;

                // Callback to override default model picking
                if (defined(model._pickFragmentShaderLoaded)) {
                    if (defined(model._pickUniformMapLoaded)) {
                        pickUniformMap = model._pickUniformMapLoaded(uniformMap);
                    } else {
                        // This is unlikely, but could happen if the override shader does not
                        // need new uniforms since, for example, its pick ids are coming from
                        // a vertex attribute or are baked into the shader source.
                        pickUniformMap = combine(uniformMap);
                    }
                } else {
                    var pickId = context.createPickId(owner);
                    pickIds.push(pickId);
                    var pickUniforms = {
                        czm_pickColor : createPickColorFunction(pickId.color)
                    };
                    pickUniformMap = combine(uniformMap, pickUniforms);
                }

                pickCommand = new DrawCommand({
                    boundingVolume : new BoundingSphere(), // updated in update()
                    cull : model.cull,
                    modelMatrix : new Matrix4(),           // computed in update()
                    primitiveType : primitive.mode,
                    vertexArray : vertexArray,
                    count : count,
                    offset : offset,
                    shaderProgram : rendererPickPrograms[technique.program],
                    uniformMap : pickUniformMap,
                    renderState : RenderState.fromCache(pickRenderState),
                    owner : owner,
                    pass : model.opaquePass
                });
            }

            var preloadCommand2D;
            var stencilCommand2D;
            var colorCommand2D;
            var pickCommand2D;
            if (!scene3DOnly) {
                preloadCommand2D = DrawCommand.shallowClone(preloadCommand);
                preloadCommand2D.boundingVolume = new BoundingSphere(); // updated in update()
                preloadCommand2D.modelMatrix = new Matrix4();           // updated in update()

                stencilCommand2D = DrawCommand.shallowClone(stencilCommand);
                stencilCommand2D.boundingVolume = preloadCommand2D.boundingVolume;
                stencilCommand2D.modelMatrix = preloadCommand2D.modelMatrix;

                colorCommand2D = DrawCommand.shallowClone(colorCommand);
                colorCommand2D.boundingVolume = preloadCommand2D.boundingVolume;
                colorCommand2D.modelMatrix = preloadCommand2D.modelMatrix;

                if (allowPicking) {
                    pickCommand2D = DrawCommand.shallowClone(pickCommand);
                    pickCommand2D.boundingVolume = preloadCommand2D.boundingVolume;
                    pickCommand2D.modelMatrix = preloadCommand2D.modelMatrix;
                }
            }

            var nodeCommand = {
                show : true,
                boundingSphere : boundingSphere,
                preloadCommand : preloadCommand,
                stencilCommand : stencilCommand,
                colorCommand : colorCommand,
                pickCommand : pickCommand,
                preloadCommand2D : preloadCommand2D,
                stencilCommand2D : stencilCommand2D,
                colorCommand2D : colorCommand2D,
                pickCommand2D : pickCommand2D
            };
            */

            var buffer = vertexArray.attributes.POSITION.vertexBuffer;
            var positionsBuffer = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);

            buffer = vertexArray.attributes._BATCHID.vertexBuffer;
            var vertexBatchIds = new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT);

            buffer = vertexArray.indexBuffer.typedArray;
            var indices;
            if (vertexArray.indexBuffer.indexDatatype === IndexDatatype.UNSIGNED_SHORT) {
                indices = new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT);
            } else {
                indices = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Uint32Array.BYTES_PER_ELEMENT);
            }

            positionsBuffer = arraySlice(positionsBuffer);
            vertexBatchIds = arraySlice(vertexBatchIds);
            indices = arraySlice(indices, offset, offset + count);

            var batchIds = [];
            var indexCounts = [];
            var indexOffsets = [];
            var batchedIndices = [];

            var currentId = vertexBatchIds[indices[0]];
            batchIds.push(currentId);
            indexOffsets.push(0);

            var indicesLength = indices.length;
            for (var j = 1; j < indicesLength; ++j) {
                var batchId = vertexBatchIds[indices[j]];
                if (batchId !== currentId) {
                    var indexOffset = indexOffsets[indexOffsets.length - 1];
                    var indexCount = j - indexOffset;

                    batchIds.push(batchId);
                    indexCounts.push(indexCount);
                    indexOffsets.push(j);

                    batchedIndices.push(new Vector3DTileBatch({
                        offset : indexOffset,
                        count : indexCount,
                        batchIds : [currentId],
                        color : Color.WHITE
                    }));

                    currentId = batchId;
                }
            }

            var shader = rendererPrograms[technique.program];
            var vertexShaderSource = shader.vertexShaderSource;
            var fragmentShaderSource = shader.fragmentShaderSource;
            var attributeLocations = shader.attributeLocations;

            var pickVertexShaderSource;
            var pickFragmentShaderSource;
            var pickUniformMap;
            if (allowPicking) {
                var pickShader = rendererPickPrograms[technique.program];
                pickVertexShaderSource = pickShader.vertexShaderSource;
                pickFragmentShaderSource = pickShader.fragmentShaderSource;

                // Callback to override default model picking
                if (defined(model._pickFragmentShaderLoaded)) {
                    if (defined(model._pickUniformMapLoaded)) {
                        pickUniformMap = model._pickUniformMapLoaded(uniformMap);
                    } else {
                        // This is unlikely, but could happen if the override shader does not
                        // need new uniforms since, for example, its pick ids are coming from
                        // a vertex attribute or are baked into the shader source.
                        pickUniformMap = combine(uniformMap);
                    }
                } else {
                    var pickId = context.createPickId(owner);
                    pickIds.push(pickId);
                    var pickUniforms = {
                        czm_pickColor : createPickColorFunction(pickId.color)
                    };
                    pickUniformMap = combine(uniformMap, pickUniforms);
                }
            }

            var nodeCommand = new Vector3DTilePrimitive({
                positions : positionsBuffer,
                indices : indices,
                indexOffsets : indexOffsets,
                indexCounts : indexCounts,
                batchIds : batchIds,
                vertexBatchIds : vertexBatchIds,
                batchedIndices : batchedIndices,
                batchTable : batchTable,
                boundingVolume : new BoundingSphere(), // updated in update()
                boundingVolumes : [], // TODO
                _vertexShaderSource : vertexShaderSource,
                _fragmentShaderSource : fragmentShaderSource,
                _attributeLocations : attributeLocations,
                _pickVertexShaderSource : pickVertexShaderSource,
                _pickFragmentShaderSource : pickFragmentShaderSource,
                _uniformMap : uniformMap,
                _pickUniformMap : pickUniformMap,
                _modelMatrix : new Matrix4(), // updated in update()
                _boundingSphere : boundingSphere // used to update boundingVolume
            });
            runtimeNode.commands.push(nodeCommand);
            nodeCommands.push(nodeCommand);
        }

    }

    function createRuntimeNodes(model, context, scene3DOnly) {
        var loadResources = model._loadResources;

        if (!loadResources.finishedEverythingButTextureCreation()) {
            return;
        }

        if (!loadResources.createRuntimeNodes) {
            return;
        }
        loadResources.createRuntimeNodes = false;

        var rootNodes = [];
        var runtimeNodes = model._runtime.nodes;

        var gltf = model.gltf;
        var nodes = gltf.nodes;

        var scene = gltf.scenes[gltf.scene];
        var sceneNodes = scene.nodes;
        var length = sceneNodes.length;

        var stack = [];
        var seen = {};

        for (var i = 0; i < length; ++i) {
            stack.push({
                parentRuntimeNode : undefined,
                gltfNode : nodes[sceneNodes[i]],
                id : sceneNodes[i]
            });

            while (stack.length > 0) {
                var n = stack.pop();
                seen[n.id] = true;
                var parentRuntimeNode = n.parentRuntimeNode;
                var gltfNode = n.gltfNode;

                // Node hierarchy is a DAG so a node can have more than one parent so it may already exist
                var runtimeNode = runtimeNodes[n.id];
                if (runtimeNode.parents.length === 0) {
                    if (defined(gltfNode.matrix)) {
                        runtimeNode.matrix = Matrix4.fromColumnMajorArray(gltfNode.matrix);
                    } else {
                        // TRS converted to Cesium types
                        var rotation = gltfNode.rotation;
                        runtimeNode.translation = Cartesian3.fromArray(gltfNode.translation);
                        runtimeNode.rotation = Quaternion.unpack(rotation);
                        runtimeNode.scale = Cartesian3.fromArray(gltfNode.scale);
                    }
                }

                if (defined(parentRuntimeNode)) {
                    parentRuntimeNode.children.push(runtimeNode);
                    runtimeNode.parents.push(parentRuntimeNode);
                } else {
                    rootNodes.push(runtimeNode);
                }

                if (defined(gltfNode.mesh)) {
                    createCommand(model, gltfNode, runtimeNode, context, scene3DOnly);
                }

                var children = gltfNode.children;
                var childrenLength = children.length;
                for (var j = 0; j < childrenLength; j++) {
                    var childId = children[j];
                    if (!seen[childId]) {
                        stack.push({
                            parentRuntimeNode : runtimeNode,
                            gltfNode : nodes[childId],
                            id : children[j]
                        });
                    }
                }
            }
        }

        model._runtime.rootNodes = rootNodes;
        model._runtime.nodes = runtimeNodes;
    }

    function createResources(model, frameState) {
        var context = frameState.context;
        var scene3DOnly = frameState.scene3DOnly;

        checkSupportedGlExtensions(model, context);
        createBuffers(model, frameState); // using glTF bufferViews
        createPrograms(model, frameState);

        if (!model._loadRendererResourcesFromCache) {
            createVertexArrays(model, context); // using glTF meshes
            // Long-term, we might not cache render states if they could change
            // due to an animation, e.g., a uniform going from opaque to transparent.
            // Could use copy-on-write if it is worth it.  Probably overkill.
        }

        createUniformMaps(model, context);               // using glTF materials/techniques
        createRuntimeNodes(model, context, scene3DOnly); // using glTF scene
    }

    ///////////////////////////////////////////////////////////////////////////

    function getNodeMatrix(node, result) {
        var publicNode = node.publicNode;
        var publicMatrix = publicNode.matrix;

        if (publicNode.useMatrix && defined(publicMatrix)) {
            // Public matrix overrides orginial glTF matrix and glTF animations
            Matrix4.clone(publicMatrix, result);
        } else if (defined(node.matrix)) {
            Matrix4.clone(node.matrix, result);
        } else {
            Matrix4.fromTranslationQuaternionRotationScale(node.translation, node.rotation, node.scale, result);
            // Keep matrix returned by the node in-sync if the node is targeted by an animation.  Only TRS nodes can be targeted.
            publicNode.setMatrix(result);
        }
    }

    var scratchNodeStack = [];
    var scratchComputedTranslation = new Cartesian4();
    var scratchComputedMatrixIn2D = new Matrix4();

    function updateNodeHierarchyModelMatrix(model, modelTransformChanged, justLoaded, projection) {
        var maxDirtyNumber = model._maxDirtyNumber;
        var allowPicking = model.allowPicking;

        var rootNodes = model._runtime.rootNodes;
        var length = rootNodes.length;

        var nodeStack = scratchNodeStack;
        var computedModelMatrix = model._computedModelMatrix;

        if ((model._mode !== SceneMode.SCENE3D) && !model._ignoreCommands) {
            var translation = Matrix4.getColumn(computedModelMatrix, 3, scratchComputedTranslation);
            if (!Cartesian4.equals(translation, Cartesian4.UNIT_W)) {
                computedModelMatrix = Transforms.basisTo2D(projection, computedModelMatrix, scratchComputedMatrixIn2D);
                model._rtcCenter = model._rtcCenter3D;
            } else {
                var center = model.boundingSphere.center;
                var to2D = Transforms.wgs84To2DModelMatrix(projection, center, scratchComputedMatrixIn2D);
                computedModelMatrix = Matrix4.multiply(to2D, computedModelMatrix, scratchComputedMatrixIn2D);

                if (defined(model._rtcCenter)) {
                    Matrix4.setTranslation(computedModelMatrix, Cartesian4.UNIT_W, computedModelMatrix);
                    model._rtcCenter = model._rtcCenter2D;
                }
            }
        }

        for (var i = 0; i < length; ++i) {
            var n = rootNodes[i];

            getNodeMatrix(n, n.transformToRoot);
            nodeStack.push(n);

            while (nodeStack.length > 0) {
                n = nodeStack.pop();
                var transformToRoot = n.transformToRoot;
                var commands = n.commands;

                if ((n.dirtyNumber === maxDirtyNumber) || modelTransformChanged || justLoaded) {
                    var nodeMatrix = Matrix4.multiplyTransformation(computedModelMatrix, transformToRoot, n.computedMatrix);
                    var commandsLength = commands.length;
                    if (commandsLength > 0) {
                        // Node has meshes, which has primitives.  Update their commands.
                        for (var j = 0; j < commandsLength; ++j) {
                            var primitiveCommand = commands[j];
                            //var command = primitiveCommand.preloadCommand;
                            //Matrix4.clone(nodeMatrix, command.modelMatrix);
                            Matrix4.clone(nodeMatrix, primitiveCommand._modelMatrix);

                            // PERFORMANCE_IDEA: Can use transformWithoutScale if no node up to the root has scale (including animation)
                            //BoundingSphere.transform(primitiveCommand.boundingSphere, command.modelMatrix, command.boundingVolume);
                            BoundingSphere.transform(primitiveCommand._boundingSphere, primitiveCommand._modelMatrix, primitiveCommand._boundingVolume);

                            if (defined(model._rtcCenter)) {
                                //Cartesian3.add(model._rtcCenter, command.boundingVolume.center, command.boundingVolume.center);
                                Cartesian3.add(model._rtcCenter, primitiveCommand._boundingVolume.center, primitiveCommand._boundingVolume.center);
                            }

                            /*
                            if (allowPicking) {
                                var pickCommand = primitiveCommand.pickCommand;
                                Matrix4.clone(command.modelMatrix, pickCommand.modelMatrix);
                                BoundingSphere.clone(command.boundingVolume, pickCommand.boundingVolume);
                            }

                            // If the model crosses the IDL in 2D, it will be drawn in one viewport, but part of it
                            // will be clipped by the viewport. We create a second command that translates the model
                            // model matrix to the opposite side of the map so the part that was clipped in one viewport
                            // is drawn in the other.
                            command = primitiveCommand.preloadCommand2D;
                            if (defined(command) && model._mode === SceneMode.SCENE2D) {
                                Matrix4.clone(nodeMatrix, command.modelMatrix);
                                command.modelMatrix[13] -= CesiumMath.sign(command.modelMatrix[13]) * 2.0 * CesiumMath.PI * projection.ellipsoid.maximumRadius;
                                BoundingSphere.transform(primitiveCommand.boundingSphere, command.modelMatrix, command.boundingVolume);

                                if (allowPicking) {
                                    var pickCommand2D = primitiveCommand.pickCommand2D;
                                    Matrix4.clone(command.modelMatrix, pickCommand2D.modelMatrix);
                                    BoundingSphere.clone(command.boundingVolume, pickCommand2D.boundingVolume);
                                }
                            }
                            */
                        }
                    }
                }

                var children = n.children;
                var childrenLength = children.length;
                for (var k = 0; k < childrenLength; ++k) {
                    var child = children[k];

                    // A node's transform needs to be updated if
                    // - It was targeted for animation this frame, or
                    // - Any of its ancestors were targeted for animation this frame

                    // PERFORMANCE_IDEA: if a child has multiple parents and only one of the parents
                    // is dirty, all the subtrees for each child instance will be dirty; we probably
                    // won't see this in the wild often.
                    child.dirtyNumber = Math.max(child.dirtyNumber, n.dirtyNumber);

                    if ((child.dirtyNumber === maxDirtyNumber) || justLoaded) {
                        // Don't check for modelTransformChanged since if only the model's model matrix changed,
                        // we do not need to rebuild the local transform-to-root, only the final
                        // [model's-model-matrix][transform-to-root] above.
                        getNodeMatrix(child, child.transformToRoot);
                        Matrix4.multiplyTransformation(transformToRoot, child.transformToRoot, child.transformToRoot);
                    }

                    nodeStack.push(child);
                }
            }
        }

        ++model._maxDirtyNumber;
    }

    function updatePerNodeShow(model) {
        // Totally not worth it, but we could optimize this:
        // http://blogs.agi.com/insight3d/index.php/2008/02/13/deletion-in-bounding-volume-hierarchies/

        var rootNodes = model._runtime.rootNodes;
        var length = rootNodes.length;

        var nodeStack = scratchNodeStack;

        for (var i = 0; i < length; ++i) {
            var n = rootNodes[i];
            n.computedShow = n.publicNode.show;
            nodeStack.push(n);

            while (nodeStack.length > 0) {
                n = nodeStack.pop();
                var show = n.computedShow;

                var nodeCommands = n.commands;
                var nodeCommandsLength = nodeCommands.length;
                for (var j = 0; j < nodeCommandsLength; ++j) {
                    nodeCommands[j].show = show;
                }
                // if commandsLength is zero, the node has a light or camera

                var children = n.children;
                var childrenLength = children.length;
                for (var k = 0; k < childrenLength; ++k) {
                    var child = children[k];
                    // Parent needs to be shown for child to be shown.
                    child.computedShow = show && child.publicNode.show;
                    nodeStack.push(child);
                }
            }
        }
    }

    function updatePickIds(model, context) {
        var id = model.id;
        if (model._id !== id) {
            model._id = id;

            var pickIds = model._pickIds;
            var length = pickIds.length;
            for (var i = 0; i < length; ++i) {
                pickIds[i].object.id = id;
            }
        }
    }

    function updateWireframe(model) {
        if (model._debugWireframe !== model.debugWireframe) {
            model._debugWireframe = model.debugWireframe;

            // This assumes the original primitive was TRIANGLES and that the triangles
            // are connected for the wireframe to look perfect.
            var primitiveType = model.debugWireframe ? PrimitiveType.LINES : PrimitiveType.TRIANGLES;
            var nodeCommands = model._nodeCommands;
            var length = nodeCommands.length;

            for (var i = 0; i < length; ++i) {
                nodeCommands[i].command.primitiveType = primitiveType;
            }
        }
    }

    function updateShowBoundingVolume(model) {
        if (model.debugShowBoundingVolume !== model._debugShowBoundingVolume) {
            model._debugShowBoundingVolume = model.debugShowBoundingVolume;

            var debugShowBoundingVolume = model.debugShowBoundingVolume;
            var nodeCommands = model._nodeCommands;
            var length = nodeCommands.length;

            for (var i = 0; i < length; ++i) {
                nodeCommands[i].command.debugShowBoundingVolume = debugShowBoundingVolume;
            }
        }
    }

    function updateClassification(model, frameState) {
        var dirty = model._classificationType !== model.classificationType || model._dirty;
        model._classificationType = model.classificationType;

        if (!dirty) {
            return;
        }

        var pass;
        switch (model._classificationType) {
            case ClassificationType.TERRAIN:
                pass = Pass.TERRAIN_CLASSIFICATION;
                break;
            case ClassificationType.CESIUM_3D_TILE:
                pass = Pass.CESIUM_3D_TILE_CLASSIFICATION;
                break;
            default:
                pass = Pass.CLASSIFICATION;
        }

        var scene3DOnly = frameState.scene3DOnly;
        var allowPicking = model.allowPicking;
        var nodeCommands = model._nodeCommands;
        var length = nodeCommands.length;
        for (var i = 0; i < length; ++i) {
            var nodeCommand = nodeCommands[i];

            nodeCommand.preloadCommand.pass = pass;
            nodeCommand.stencilCommand.pass = pass;
            nodeCommand.colorCommand.pass = pass;

            if (allowPicking) {
                nodeCommand.pickCommand.pass = pass;
            }

            if (!scene3DOnly) {
                nodeCommand.preloadCommand2D.pass = pass;
                nodeCommand.stencilCommand2D.pass = pass;
                nodeCommand.colorCommand2D.pass = pass;

                if (allowPicking) {
                    nodeCommand.pickCommand2D.pass = pass;
                }
            }
        }
    }

    var scratchBoundingSphere = new BoundingSphere();

    function scaleInPixels(positionWC, radius, frameState) {
        scratchBoundingSphere.center = positionWC;
        scratchBoundingSphere.radius = radius;
        return frameState.camera.getPixelSize(scratchBoundingSphere, frameState.context.drawingBufferWidth, frameState.context.drawingBufferHeight);
    }

    var scratchPosition = new Cartesian3();
    var scratchCartographic = new Cartographic();

    function getScale(model, frameState) {
        var scale = model.scale;

        if (model.minimumPixelSize !== 0.0) {
            // Compute size of bounding sphere in pixels
            var context = frameState.context;
            var maxPixelSize = Math.max(context.drawingBufferWidth, context.drawingBufferHeight);
            var m = defined(model._clampedModelMatrix) ? model._clampedModelMatrix : model.modelMatrix;
            scratchPosition.x = m[12];
            scratchPosition.y = m[13];
            scratchPosition.z = m[14];

            if (defined(model._rtcCenter)) {
                Cartesian3.add(model._rtcCenter, scratchPosition, scratchPosition);
            }

            if (model._mode !== SceneMode.SCENE3D) {
                var projection = frameState.mapProjection;
                var cartographic = projection.ellipsoid.cartesianToCartographic(scratchPosition, scratchCartographic);
                projection.project(cartographic, scratchPosition);
                Cartesian3.fromElements(scratchPosition.z, scratchPosition.x, scratchPosition.y, scratchPosition);
            }

            var radius = model.boundingSphere.radius;
            var metersPerPixel = scaleInPixels(scratchPosition, radius, frameState);

            // metersPerPixel is always > 0.0
            var pixelsPerMeter = 1.0 / metersPerPixel;
            var diameterInPixels = Math.min(pixelsPerMeter * (2.0 * radius), maxPixelSize);

            // Maintain model's minimum pixel size
            if (diameterInPixels < model.minimumPixelSize) {
                scale = (model.minimumPixelSize * metersPerPixel) / (2.0 * model._initialRadius);
            }
        }

        return defined(model.maximumScale) ? Math.min(model.maximumScale, scale) : scale;
    }

    function releaseCachedGltf(model) {
        if (defined(model._cacheKey) && defined(model._cachedGltf) && (--model._cachedGltf.count === 0)) {
            delete gltfCache[model._cacheKey];
        }
        model._cachedGltf = undefined;
    }

    function checkSupportedExtensions(model) {
        var extensionsRequired = model.extensionsRequired;
        for (var extension in extensionsRequired) {
            if (extensionsRequired.hasOwnProperty(extension)) {
                if (extension !== 'CESIUM_RTC' &&
                    extension !== 'KHR_technique_webgl' &&
                    extension !== 'KHR_binary_glTF' &&
                    extension !== 'KHR_materials_common' &&
                    extension !== 'WEB3D_quantized_attributes') {
                    throw new RuntimeError('Unsupported glTF Extension: ' + extension);
                }
            }
        }
    }

    function checkSupportedGlExtensions(model, context) {
        var glExtensionsUsed = model.gltf.glExtensionsUsed;
        if (defined(glExtensionsUsed)) {
            var glExtensionsUsedLength = glExtensionsUsed.length;
            for (var i = 0; i < glExtensionsUsedLength; i++) {
                var extension = glExtensionsUsed[i];
                if (extension !== 'OES_element_index_uint') {
                    throw new RuntimeError('Unsupported WebGL Extension: ' + extension);
                } else if (!context.elementIndexUint) {
                    throw new RuntimeError('OES_element_index_uint WebGL extension is not enabled.');
                }
            }
        }
    }

    ///////////////////////////////////////////////////////////////////////////

    function CachedRendererResources(context, cacheKey) {
        this.buffers = undefined;
        this.vertexArrays = undefined;
        this.programs = undefined;
        this.pickPrograms = undefined;
        this.classificationPrograms = undefined;
        this.renderStates = undefined;
        this.ready = false;

        this.context = context;
        this.cacheKey = cacheKey;
        this.count = 0;
    }

    function destroy(property) {
        for (var name in property) {
            if (property.hasOwnProperty(name)) {
                property[name].destroy();
            }
        }
    }

    function destroyCachedRendererResources(resources) {
        destroy(resources.buffers);
        destroy(resources.vertexArrays);
        destroy(resources.programs);
        destroy(resources.pickPrograms);
        destroy(resources.classificationPrograms);
    }

    CachedRendererResources.prototype.release = function() {
        if (--this.count === 0) {
            if (defined(this.cacheKey)) {
                // Remove if this was cached
                delete this.context.cache.modelRendererResourceCache[this.cacheKey];
            }
            destroyCachedRendererResources(this);
            return destroyObject(this);
        }

        return undefined;
    };

    ///////////////////////////////////////////////////////////////////////////

    function getUpdateHeightCallback(model, ellipsoid, cartoPosition) {
        return function(clampedPosition) {
            if (model.heightReference === HeightReference.RELATIVE_TO_GROUND) {
                var clampedCart = ellipsoid.cartesianToCartographic(clampedPosition, scratchCartographic);
                clampedCart.height += cartoPosition.height;
                ellipsoid.cartographicToCartesian(clampedCart, clampedPosition);
            }

            var clampedModelMatrix = model._clampedModelMatrix;

            // Modify clamped model matrix to use new height
            Matrix4.clone(model.modelMatrix, clampedModelMatrix);
            clampedModelMatrix[12] = clampedPosition.x;
            clampedModelMatrix[13] = clampedPosition.y;
            clampedModelMatrix[14] = clampedPosition.z;

            model._heightChanged = true;
        };
    }

    function updateClamping(model) {
        if (defined(model._removeUpdateHeightCallback)) {
            model._removeUpdateHeightCallback();
            model._removeUpdateHeightCallback = undefined;
        }

        var scene = model._scene;
        if (!defined(scene) || (model.heightReference === HeightReference.NONE)) {
            //>>includeStart('debug', pragmas.debug);
            if (model.heightReference !== HeightReference.NONE) {
                throw new DeveloperError('Height reference is not supported without a scene.');
            }
            //>>includeEnd('debug');
            model._clampedModelMatrix = undefined;
            return;
        }

        var globe = scene.globe;
        var ellipsoid = globe.ellipsoid;

        // Compute cartographic position so we don't recompute every update
        var modelMatrix = model.modelMatrix;
        scratchPosition.x = modelMatrix[12];
        scratchPosition.y = modelMatrix[13];
        scratchPosition.z = modelMatrix[14];
        var cartoPosition = ellipsoid.cartesianToCartographic(scratchPosition);

        if (!defined(model._clampedModelMatrix)) {
            model._clampedModelMatrix = Matrix4.clone(modelMatrix, new Matrix4());
        }

        // Install callback to handle updating of terrain tiles
        var surface = globe._surface;
        model._removeUpdateHeightCallback = surface.updateHeight(cartoPosition, getUpdateHeightCallback(model, ellipsoid, cartoPosition));

        // Set the correct height now
        var height = globe.getHeight(cartoPosition);
        if (defined(height)) {
            // Get callback with cartoPosition being the non-clamped position
            var cb = getUpdateHeightCallback(model, ellipsoid, cartoPosition);

            // Compute the clamped cartesian and call updateHeight callback
            Cartographic.clone(cartoPosition, scratchCartographic);
            scratchCartographic.height = height;
            ellipsoid.cartographicToCartesian(scratchCartographic, scratchPosition);
            cb(scratchPosition);
        }
    }

    var scratchDisplayConditionCartesian = new Cartesian3();
    var scratchDistanceDisplayConditionCartographic = new Cartographic();

    function distanceDisplayConditionVisible(model, frameState) {
        var distance2;
        var ddc = model.distanceDisplayCondition;
        var nearSquared = ddc.near * ddc.near;
        var farSquared = ddc.far * ddc.far;

        if (frameState.mode === SceneMode.SCENE2D) {
            var frustum2DWidth = frameState.camera.frustum.right - frameState.camera.frustum.left;
            distance2 = frustum2DWidth * 0.5;
            distance2 = distance2 * distance2;
        } else {
            // Distance to center of primitive's reference frame
            var position = Matrix4.getTranslation(model.modelMatrix, scratchDisplayConditionCartesian);
            if (frameState.mode === SceneMode.COLUMBUS_VIEW) {
                var projection = frameState.mapProjection;
                var ellipsoid = projection.ellipsoid;
                var cartographic = ellipsoid.cartesianToCartographic(position, scratchDistanceDisplayConditionCartographic);
                position = projection.project(cartographic, position);
                Cartesian3.fromElements(position.z, position.x, position.y, position);
            }
            distance2 = Cartesian3.distanceSquared(position, frameState.camera.positionWC);
        }

        return (distance2 >= nearSquared) && (distance2 <= farSquared);
    }

    /**
     * Called when {@link Viewer} or {@link CesiumWidget} render the scene to
     * get the draw commands needed to render this primitive.
     * <p>
     * Do not call this function directly.  This is documented just to
     * list the exceptions that may be propagated when the scene is rendered:
     * </p>
     *
     * @exception {RuntimeError} Failed to load external reference.
     */
    Model.prototype.update = function(frameState) {
        if (frameState.mode === SceneMode.MORPHING) {
            return;
        }

        //var context = frameState.context;

        if ((this._state === ModelState.NEEDS_LOAD) && defined(this.gltf)) {
            this._state = ModelState.LOADING;
            if (this._state !== ModelState.FAILED) {
                var extensions = this.gltf.extensions;
                if (defined(extensions) && defined(extensions.CESIUM_RTC)) {
                    var center = Cartesian3.fromArray(extensions.CESIUM_RTC.center);
                    if (!Cartesian3.equals(center, Cartesian3.ZERO)) {
                        this._rtcCenter3D = center;

                        var projection = frameState.mapProjection;
                        var ellipsoid = projection.ellipsoid;
                        var cartographic = ellipsoid.cartesianToCartographic(this._rtcCenter3D);
                        var projectedCart = projection.project(cartographic);
                        Cartesian3.fromElements(projectedCart.z, projectedCart.x, projectedCart.y, projectedCart);
                        this._rtcCenter2D = projectedCart;

                        this._rtcCenterEye = new Cartesian3();
                        this._rtcCenter = this._rtcCenter3D;
                    }
                }

                this._loadResources = new LoadResources();
                if (!this._loadRendererResourcesFromCache) {
                    // Buffers are required to updateVersion
                    parseBuffers(this);
                }
            }
        }

        var loadResources = this._loadResources;
        var justLoaded = false;

        if (this._state === ModelState.LOADING) {
            // Transition from LOADING -> LOADED once resources are downloaded and created.
            // Textures may continue to stream in while in the LOADED state.
            if (loadResources.pendingBufferLoads === 0) {
                if (!this._updatedGltfVersion) {
                    checkSupportedExtensions(this);
                    // We do this after to make sure that the ids don't change
                    addBuffersToLoadResources(this);

                    parseBufferViews(this);
                    parsePrograms(this);
                    parseMaterials(this);
                    parseMeshes(this);
                    parseNodes(this);

                    this._boundingSphere = computeBoundingSphere(this);
                    this._initialRadius = this._boundingSphere.radius;
                    this._updatedGltfVersion = true;
                }
                if (this._updatedGltfVersion && loadResources.pendingShaderLoads === 0) {
                    createResources(this, frameState);
                }
            }
            if (loadResources.finished()) {
                this._state = ModelState.LOADED;
                justLoaded = true;
            }
        }

        // Incrementally stream textures.
        if (defined(loadResources) && (this._state === ModelState.LOADED)) {
            if (!justLoaded) {
                createResources(this, frameState);
            }

            if (loadResources.finished()) {
                this._loadResources = undefined;  // Clear CPU memory since WebGL resources were created.

                // The normal attribute name is required for silhouettes, so get it before the gltf JSON is released
                this._normalAttributeName = getAttributeOrUniformBySemantic(this.gltf, 'NORMAL');
                releaseCachedGltf(this);
            }
        }

        var displayConditionPassed = defined(this.distanceDisplayCondition) ? distanceDisplayConditionVisible(this, frameState) : true;
        var show = this.show && displayConditionPassed && (this.scale !== 0.0);

        if ((show && this._state === ModelState.LOADED) || justLoaded) {
            this._dirty = false;
            var modelMatrix = this.modelMatrix;

            var modeChanged = frameState.mode !== this._mode;
            this._mode = frameState.mode;

            // Model's model matrix needs to be updated
            var modelTransformChanged = !Matrix4.equals(this._modelMatrix, modelMatrix) ||
                                        (this._scale !== this.scale) ||
                                        (this._minimumPixelSize !== this.minimumPixelSize) || (this.minimumPixelSize !== 0.0) || // Minimum pixel size changed or is enabled
                                        (this._maximumScale !== this.maximumScale) ||
                                        (this._heightReference !== this.heightReference) || this._heightChanged ||
                                        modeChanged;

            if (modelTransformChanged || justLoaded) {
                Matrix4.clone(modelMatrix, this._modelMatrix);

                updateClamping(this);

                if (defined(this._clampedModelMatrix)) {
                    modelMatrix = this._clampedModelMatrix;
                }

                this._scale = this.scale;
                this._minimumPixelSize = this.minimumPixelSize;
                this._maximumScale = this.maximumScale;
                this._heightReference = this.heightReference;
                this._heightChanged = false;

                var scale = getScale(this, frameState);
                var computedModelMatrix = this._computedModelMatrix;
                Matrix4.multiplyByUniformScale(modelMatrix, scale, computedModelMatrix);
                if (this._upAxis === Axis.Y) {
                    Matrix4.multiplyTransformation(computedModelMatrix, Axis.Y_UP_TO_Z_UP, computedModelMatrix);
                } else if (this._upAxis === Axis.X) {
                    Matrix4.multiplyTransformation(computedModelMatrix, Axis.X_UP_TO_Z_UP, computedModelMatrix);
                }
            }

            // Update modelMatrix throughout the graph as needed
            if (modelTransformChanged || justLoaded) {
                updateNodeHierarchyModelMatrix(this, modelTransformChanged, justLoaded, frameState.mapProjection);
                this._dirty = true;
            }

            /*
            if (this._perNodeShowDirty) {
                this._perNodeShowDirty = false;
                updatePerNodeShow(this);
            }
            updatePickIds(this, context);
            updateWireframe(this);
            updateShowBoundingVolume(this);
            updateClassification(this, frameState);
            */
        }

        if (justLoaded) {
            // Called after modelMatrix update.
            var model = this;
            frameState.afterRender.push(function() {
                model._ready = true;
                model._readyPromise.resolve(model);
            });
            return;
        }

        // We don't check show at the top of the function since we
        // want to be able to progressively load models when they are not shown,
        // and then have them visible immediately when show is set to true.
        if (show && !this._ignoreCommands) {
            // PERFORMANCE_IDEA: This is terrible
            //var commandList = frameState.commandList;
            //var passes = frameState.passes;
            var nodeCommands = this._nodeCommands;
            var length = nodeCommands.length;
            var i;
            var nc;

            /*
            var idl2D = frameState.mapProjection.ellipsoid.maximumRadius * CesiumMath.PI;
            var boundingVolume;

            if (passes.render) {
                for (i = 0; i < length; ++i) {
                    nc = nodeCommands[i];
                    if (nc.show) {
                        boundingVolume = nc.boundingVolume;
                        if (frameState.mode === SceneMode.SCENE2D &&
                            (boundingVolume.center.y + boundingVolume.radius > idl2D || boundingVolume.center.y - boundingVolume.radius < idl2D)) {
                            commandList.push(nc.preloadCommand2D);
                            commandList.push(nc.stencilCommand2D);
                            commandList.push(nc.colorCommand2D);
                        } else {
                            commandList.push(nc.preloadCommand);
                            commandList.push(nc.stencilCommand);
                            commandList.push(nc.colorCommand);
                        }
                    }
                }
            }

            if (passes.pick && this.allowPicking) {
                for (i = 0; i < length; ++i) {
                    nc = nodeCommands[i];
                    if (nc.show) {
                        boundingVolume = nc.boundingVolume;
                        if (frameState.mode === SceneMode.SCENE2D &&
                            (boundingVolume.center.y + boundingVolume.radius > idl2D || boundingVolume.center.y - boundingVolume.radius < idl2D)) {
                            commandList.push(nc.preloadCommand2D);
                            commandList.push(nc.stencilCommand2D);
                            commandList.push(nc.pickCommand2D);
                        } else {
                            commandList.push(nc.preloadCommand);
                            commandList.push(nc.stencilCommand);
                            commandList.push(nc.pickCommand);
                        }
                    }
                }
            }
            */

            for (i = 0; i < length; ++i) {
                nc = nodeCommands[i];
                //if (nc.show) {
                    nc.update(frameState);
                //}
            }
        }
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     *
     * @see Model#destroy
     */
    Model.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @returns {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     *
     * @example
     * model = model && model.destroy();
     *
     * @see Model#isDestroyed
     */
    Model.prototype.destroy = function() {
        if (defined(this._removeUpdateHeightCallback)) {
            this._removeUpdateHeightCallback();
            this._removeUpdateHeightCallback = undefined;
        }

        if (defined(this._terrainProviderChangedCallback)) {
            this._terrainProviderChangedCallback();
            this._terrainProviderChangedCallback = undefined;
        }

        this._rendererResources = undefined;
        this._cachedRendererResources = this._cachedRendererResources && this._cachedRendererResources.release();

        var pickIds = this._pickIds;
        var length = pickIds.length;
        for (var i = 0; i < length; ++i) {
            pickIds[i].destroy();
        }

        releaseCachedGltf(this);

        return destroyObject(this);
    };

    return Model;
});