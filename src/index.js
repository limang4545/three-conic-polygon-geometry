// 将侧边和顶面分开输入， 并增加侧面uv贴图
import {
  BufferGeometry,
  Float32BufferAttribute
} from 'three';

const THREE = window.THREE
  ? window.THREE // Prefer consumption from global THREE, if exists
  : {
  BufferGeometry,
  Float32BufferAttribute
};

import { merge as flatten } from 'd3-array';
import earcut from 'earcut';

import geoPolygonTriangulate from './geoPolygonTriangulate';

// support both modes for backwards threejs compatibility
const setAttributeFn = new THREE.BufferGeometry().setAttribute ? 'setAttribute' : 'addAttribute';
function getMapGeo(polygonGeoJson, startHeight, endHeight, closedBottom, closedTop, includeSides, curvatureResolution) {
  curvatureResolution = curvatureResolution || 5; // in angular degrees
  // pre-calculate contour and triangulation
  const {contour, triangles} = geoPolygonTriangulate(polygonGeoJson, {resolution: curvatureResolution});

  
  if (includeSides) {
    return {
      sideGeo: new sideBufferGeoMetry(contour, triangles, startHeight, endHeight),
      topGeo: new ConicPolygonBufferGeometry(contour, triangles, startHeight, endHeight, closedBottom, closedTop)
    }
  } else {
    return {
      topGeo: new ConicPolygonBufferGeometry(contour, triangles, startHeight, endHeight, closedBottom, closedTop)
    }
  }
}

class sideBufferGeoMetry extends THREE.BufferGeometry {
  constructor(contour, triangles, startHeight, endHeight) {
    super();

    this.type = 'sideBufferGeoMetry';

    this.parameters = {
      startHeight,
      endHeight
    };

    // defaults
    startHeight = startHeight || 0;
    endHeight = endHeight || 1;

    let vertices = [];
    let indices = [];
    let uvs = [];
    let groupCnt = 0; // add groups to apply different materials to torso / caps

    const addGroup = groupData => {
      const prevVertCnt = Math.round(vertices.length / 3);
      const prevIndCnt = indices.length;

      vertices = vertices.concat(groupData.vertices);
      uvs = uvs.concat(groupData.uvs);
      indices = indices.concat(!prevVertCnt ? groupData.indices : groupData.indices.map(ind => ind + prevVertCnt));

      this.addGroup(prevIndCnt, indices.length - prevIndCnt, groupCnt++);
    };

    addGroup(generateTorso());

    // build geometry
    this.setIndex(indices);
    this[setAttributeFn]('position', new THREE.Float32BufferAttribute(vertices, 3));
    this[setAttributeFn]('uv', new THREE.Float32BufferAttribute(uvs, 2));

    // auto-calculate normals
    this.computeFaceNormals();
    this.computeVertexNormals();

    //

    function generateVertices(polygon, altitude) {
      const coords3d = polygon.map(coords => coords.map(([lng, lat]) => polar2Cartesian(lat, lng, altitude)));
      // returns { vertices, holes, coordinates }. Each point generates 3 vertice items (x,y,z).
      return earcut.flatten(coords3d);
    }

    function generateTorso() {
      const {vertices: bottomVerts, holes} = generateVertices(contour, startHeight);
      const {vertices: topVerts} = generateVertices(contour, endHeight);

      const vertices = flatten([topVerts, bottomVerts]);
      const numPoints = Math.round(topVerts.length / 3);

      const holesIdx = new Set(holes);
      let lastHoleIdx = 0;

      const indices = [];
      const uvs = [];
      const topUvs = [];
      const btmUvs = [];
      const uvImgLen = 64;
      let totalDist = 0;
      for (let v0Idx = 0; v0Idx < numPoints; v0Idx++) {
        let v1Idx = v0Idx + 1; // next point
        if (v1Idx === numPoints) {
          v1Idx = lastHoleIdx; // close final loop
        } else if (holesIdx.has(v1Idx)) {
          const holeIdx = v1Idx;
          v1Idx = lastHoleIdx; // close hole loop
          lastHoleIdx = holeIdx;
        }

        // Each pair of coords generates two triangles (faces)
        indices.push(v0Idx, v0Idx + numPoints, v1Idx + numPoints);
        indices.push(v1Idx + numPoints, v1Idx, v0Idx);

        if (v0Idx +1 === numPoints) {
          continue;
        }
        let curPos = [topVerts[v0Idx * 3], topVerts[v0Idx * 3 + 1], topVerts[v0Idx * 3 + 2]];
        let nextPos = [topVerts[v1Idx * 3], topVerts[v1Idx * 3 + 1], topVerts[v1Idx * 3 + 2]];
        totalDist = totalDist + calDistance(curPos, nextPos) / uvImgLen;
        totalDist = totalDist % 1;
        if (v0Idx === 0) {
          topUvs.push(0,1)
          btmUvs.push(0,0)
        }
        topUvs.push(totalDist,1)
        btmUvs.push(totalDist,0)
      }

      return {indices, vertices, uvs: topUvs.concat(btmUvs)};
    }
    function calDistance(starts, ends) {
      if (!starts || !ends || starts.length !== ends.length) {
        return 0;
      }
      let sum = 0;
      starts.forEach((d, idx) => {
        sum += Math.pow(ends[idx] - starts[idx], 2);
      });
      return Math.sqrt(sum);
    }
  }
}

class ConicPolygonBufferGeometry extends THREE.BufferGeometry {
  constructor(contour, triangles, startHeight, endHeight, closedBottom, closedTop) {
    super();

    this.type = 'ConicPolygonBufferGeometry';

    this.parameters = {
      startHeight,
      endHeight,
      closedBottom,
      closedTop
    };

    // defaults
    startHeight = startHeight || 0;
    endHeight = endHeight || 1;
    closedBottom = closedBottom !== undefined ? closedBottom : true;
    closedTop = closedTop !== undefined ? closedTop : true;

    let vertices = [];
    let indices = [];
    let groupCnt = 0; // add groups to apply different materials to torso / caps

    const addGroup = groupData => {
      const prevVertCnt = Math.round(vertices.length / 3);
      const prevIndCnt = indices.length;

      vertices = vertices.concat(groupData.vertices);
      indices = indices.concat(!prevVertCnt ? groupData.indices : groupData.indices.map(ind => ind + prevVertCnt));

      this.addGroup(prevIndCnt, indices.length - prevIndCnt, groupCnt++);
    };

    closedBottom && addGroup(generateCap(startHeight, false));
    closedTop && addGroup(generateCap(endHeight, true));

    // build geometry
    this.setIndex(indices);
    this[setAttributeFn]('position', new THREE.Float32BufferAttribute(vertices, 3));

    // auto-calculate normals
    this.computeFaceNormals();
    this.computeVertexNormals();

    //

    function generateVertices(polygon, altitude) {
      const coords3d = polygon.map(coords => coords.map(([lng, lat]) => polar2Cartesian(lat, lng, altitude)));
      // returns { vertices, holes, coordinates }. Each point generates 3 vertice items (x,y,z).
      return earcut.flatten(coords3d);
    }

    function generateCap(radius, isTop = true) {
      return {
        // need to reverse-wind the bottom triangles to make them face outwards
        indices: isTop ? triangles.indices : triangles.indices.slice().reverse(),
        vertices: generateVertices([triangles.points], radius).vertices
      }
    }
  }
}

//

function polar2Cartesian(lat, lng, r = 0) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (90 - lng) * Math.PI / 180;
  return [
    r * Math.sin(phi) * Math.cos(theta), // x
    r * Math.cos(phi), // y
    r * Math.sin(phi) * Math.sin(theta) // z
  ];
}

export { getMapGeo };
