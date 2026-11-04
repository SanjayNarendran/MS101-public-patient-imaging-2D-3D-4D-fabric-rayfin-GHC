import { createElement } from 'react';
import {
  addTool,
  Enums as ToolEnums,
  TrackballRotateTool,
  VolumeCroppingControlTool,
  VolumeCroppingTool,
} from '@cornerstonejs/tools';
import { Icons } from '@ohif/ui-next';

/**
 * "Crop 3D": Cornerstone3D's volume cropping tools, which OHIF 3.13 ships but does not put on its toolbar.
 * The 3D view gets a box with a handle on each face and corner (drag to cut away tissue, drag elsewhere to rotate,
 * Shift-drag to tilt the box); the slice views show the box edges, which can also be dragged.
 * The toolbar button itself is declared in ohif/config/rayfin.js.
 */

const VR_GROUP = 'volume3d';
const MPR_GROUP = 'mpr';
const CROP = VolumeCroppingTool.toolName;
const CONTROL = VolumeCroppingControlTool.toolName;
const ROTATE = TrackballRotateTool.toolName;
const CROP_FACTOR = 0.1;

export const CROP_ICON = 'rayfin-crop-3d';
export const CROP_EVALUATOR = 'evaluate.rayfin.crop3d';

const state: {
  on: boolean;
  viewportId: string | null;
  element: HTMLElement | null;
  unsubscribe: (() => void) | null;
} = {
  on: false,
  viewportId: null,
  element: null,
  unsubscribe: null,
};

function cropIcon(props: Record<string, unknown>) {
  return createElement(
    'svg',
    {
      width: 24,
      height: 24,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      ...props,
    },
    createElement('path', { d: 'M7 3v14h14' }),
    createElement('path', { d: 'M3 7h14v14' })
  );
}

/** Registers the tools with Cornerstone (once per page) and the toolbar icon. */
export function registerCropTools() {
  for (const tool of [VolumeCroppingTool, VolumeCroppingControlTool]) {
    try {
      addTool(tool);
    } catch {
      // already registered
    }
  }
  Icons.addIcon(CROP_ICON, cropIcon);
}

function groups(toolGroupService: any) {
  return {
    vr: toolGroupService.getToolGroup(VR_GROUP) || null,
    mpr: toolGroupService.getToolGroup(MPR_GROUP) || null,
  };
}

function vrViewportId(vr: any): string | null {
  return vr?.getViewportIds?.()[0] ?? null;
}

function viewportElement(services: any, viewportId: string | null): HTMLElement | null {
  if (!viewportId) return null;
  return services.cornerstoneViewportService.getCornerstoneViewport(viewportId)?.element ?? null;
}

/** Forgets handles drawn in a 3D view that no longer exists, so the next crop starts clean. */
function forgetHandles(crop: any) {
  if (!crop) return;
  crop.sphereStates = [];
  crop.edgeLines = {};
  crop.originalClippingPlanes = [];
}

function turnOn(services: any) {
  const { vr, mpr } = groups(services.toolGroupService);
  const viewportId = vrViewportId(vr);
  if (!vr || !viewportId) return;

  if (!vr.hasTool(CROP)) {
    vr.addTool(CROP, { initialCropFactor: CROP_FACTOR, sphereRadius: 6, showCornerSpheres: true });
  }
  const crop = vr.getToolInstance(CROP);
  const element = viewportElement(services, viewportId);
  if (state.element && state.element !== element) forgetHandles(crop);

  // The cropping tool rotates the volume itself when a drag starts away from a handle, so it takes over 3D Rotate.
  if (vr.hasTool(ROTATE)) vr.setToolPassive(ROTATE);
  vr.setToolActive(CROP, {
    bindings: [
      { mouseButton: ToolEnums.MouseBindings.Primary },
      { mouseButton: ToolEnums.MouseBindings.Primary, modifierKey: ToolEnums.KeyboardBindings.Shift },
    ],
  });
  crop.setClippingPlanesVisible(true);

  if (mpr?.getViewportIds().length) {
    if (!mpr.hasTool(CONTROL)) {
      mpr.addTool(CONTROL, { initialCropFactor: CROP_FACTOR, viewportIndicators: false });
    }
    // Activation draws the box edges on the slices; passive keeps them draggable without taking the left button.
    mpr.setToolActive(CONTROL, { bindings: [] });
    mpr.setToolPassive(CONTROL);
  }

  state.on = true;
  state.viewportId = viewportId;
  state.element = element;
}

function turnOff(services: any, { viewportGone = false } = {}) {
  const { vr, mpr } = groups(services.toolGroupService);
  const crop = vr?.hasTool(CROP) ? vr.getToolInstance(CROP) : null;
  if (crop) {
    if (viewportGone) {
      forgetHandles(crop);
    } else {
      try {
        crop.setClippingPlanesVisible(false);
      } catch {
        forgetHandles(crop);
      }
    }
    vr.setToolDisabled(CROP);
  }
  if (vr?.hasTool(ROTATE)) {
    vr.setToolActive(ROTATE, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] });
  }
  if (mpr?.hasTool(CONTROL)) mpr.setToolDisabled(CONTROL);
  state.on = false;
}

function refresh(services: any) {
  const viewportId = services.viewportGridService.getActiveViewportId();
  services.toolbarService.refreshToolbarState({ viewportId });
}

export function getCropCommands({ servicesManager }: any) {
  return {
    definitions: {
      rayfinToggleCrop3D: {
        commandFn: () => {
          const services = servicesManager.services;
          if (state.on) {
            turnOff(services);
          } else {
            turnOn(services);
          }
          refresh(services);
        },
      },
    },
    defaultContext: 'VIEWER',
  };
}

export function getCropEvaluators({ servicesManager }: any) {
  return [
    {
      name: CROP_EVALUATOR,
      evaluate: () => {
        const { vr } = groups(servicesManager.services.toolGroupService);
        if (!vrViewportId(vr)) {
          return { disabled: true, disabledText: 'Choose a layout with a 3D view (Layout › 3D four up) to crop' };
        }
        return { disabled: false, isActive: state.on };
      },
    },
  ];
}

/** Turns cropping off when the 3D view it was attached to goes away (layout change). */
export function watchCropLayout(services: any) {
  const { viewportGridService } = services;
  const check = () => {
    if (!state.on) return;
    const { vr } = groups(services.toolGroupService);
    const viewportId = vrViewportId(vr);
    if (viewportId !== state.viewportId || viewportElement(services, viewportId) !== state.element) {
      turnOff(services, { viewportGone: true });
      refresh(services);
    }
  };
  const subs = [
    viewportGridService.subscribe(viewportGridService.EVENTS.LAYOUT_CHANGED, check),
    viewportGridService.subscribe(viewportGridService.EVENTS.VIEWPORTS_READY, check),
  ];
  state.unsubscribe = () => subs.forEach((s: any) => s.unsubscribe());
}

export function resetCrop() {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.on = false;
  state.viewportId = null;
  state.element = null;
}
