defineSuite([
        'Core/PlaneGeometry',
        'Core/Cartesian3',
        'Core/VertexFormat',
        'Specs/createPackableSpecs'
    ], function(
        PlaneGeometry,
        Cartesian3,
        VertexFormat,
        createPackableSpecs) {
    'use strict';

    it('constructor creates optimized number of positions for VertexFormat.POSITIONS_ONLY', function() {
        var m = PlaneGeometry.createGeometry(new PlaneGeometry({
            vertexFormat : VertexFormat.POSITION_ONLY
        }));

        expect(m.attributes.position.values.length).toEqual(4 * 3); // 4 corners
        expect(m.indices.length).toEqual(4 * 3); // 2 sides x 2 triangles per side
    });

    it('constructor computes all vertex attributes', function() {
        var m = PlaneGeometry.createGeometry(new PlaneGeometry({
            vertexFormat : VertexFormat.ALL
        }));

        var numVertices = 8; //2 sides x 4 corners
        var numTriangles = 4; //2 sides x 2 triangles per side
        expect(m.attributes.position.values.length).toEqual(numVertices * 3);
        expect(m.attributes.normal.values.length).toEqual(numVertices * 3);
        expect(m.attributes.tangent.values.length).toEqual(numVertices * 3);
        expect(m.attributes.bitangent.values.length).toEqual(numVertices * 3);
        expect(m.attributes.st.values.length).toEqual(numVertices * 2);

        expect(m.indices.length).toEqual(numTriangles * 3);

        expect(m.boundingSphere.center).toEqual(Cartesian3.ZERO);
        expect(m.boundingSphere.radius).toEqual(Math.sqrt(2.0)/2.0);
    });

    createPackableSpecs(PlaneGeometry, new PlaneGeometry({
        vertexFormat : VertexFormat.POSITION_AND_NORMAL
    }), [1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
});
