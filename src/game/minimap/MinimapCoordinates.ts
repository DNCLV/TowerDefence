/** A point on the Babylon ground plane, in world units. */
export interface GroundPoint {
  x: number;
  z: number;
}

/** Fractional logical map coordinates: X left-to-right, Y spawn/top-to-goal/bottom. */
export interface LogicalMapPoint {
  x: number;
  y: number;
}

export interface LogicalMapBounds extends LogicalMapPoint {
  width: number;
  height: number;
}

export interface MinimapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The same orientation as gridToWorld3D: logical map Y is world Z, increasing downward. */
export function groundPointToLogicalMap(point: GroundPoint, worldUnitsPerCell: number): LogicalMapPoint {
  return { x: point.x / worldUnitsPerCell, y: point.z / worldUnitsPerCell };
}

/** Encloses a screen-space ground footprint in logical grid coordinates for the minimap. */
export function groundFootprintToLogicalBounds(points: readonly GroundPoint[], worldUnitsPerCell: number): LogicalMapBounds {
  if (points.length === 0) throw new Error("A camera footprint needs at least one ground point.");
  const first = groundPointToLogicalMap(points[0], worldUnitsPerCell);
  let minX = first.x, maxX = first.x, minY = first.y, maxY = first.y;
  for (let index = 1; index < points.length; index += 1) {
    const point = groundPointToLogicalMap(points[index], worldUnitsPerCell);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Shared logical-grid-to-canvas projection for terrain-aligned minimap markers and viewport. */
export function logicalMapPointToMinimap(
  point: LogicalMapPoint,
  mapWidth: number,
  mapHeight: number,
  rect: MinimapRect,
): LogicalMapPoint {
  return {
    x: rect.x + point.x / mapWidth * rect.width,
    y: rect.y + point.y / mapHeight * rect.height,
  };
}
