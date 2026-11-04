import { getCropCommands, getCropEvaluators, registerCropTools, resetCrop, watchCropLayout } from './crop3d';
import { createRayfinDataSource } from './dataSource';
import { installFluorescenceSupport } from './fluorescence';
import { installPhasePlayer, resetPhasePlayer } from './phases';
import { injectTheme } from './theme';

/**
 * Rayfin Imaging extension for OHIF: a read-only data source over original DICOM files in a Fabric Lakehouse
 * (OneLake), the Rayfin look, and a "Crop 3D" tool. Referenced in the app config as
 * `@rayfin/ohif-extension.dataSourcesModule.rayfin`.
 */
const extension = {
  id: '@rayfin/ohif-extension',
  preRegistration: () => {
    injectTheme();
    registerCropTools();
  },
  onModeEnter: ({ servicesManager, extensionManager }: any) => {
    installFluorescenceSupport(servicesManager.services.microscopyService, () => {
      return extensionManager.getActiveDataSource?.()?.[0]?.retrieve?.displayPresets;
    });
    installPhasePlayer(servicesManager.services);
    watchCropLayout(servicesManager.services);
  },
  onModeExit: () => {
    resetPhasePlayer();
    resetCrop();
  },
  getCommandsModule: getCropCommands,
  getToolbarModule: getCropEvaluators,
  getDataSourcesModule: () => [
    {
      name: 'rayfin',
      type: 'webApi',
      createDataSource: createRayfinDataSource,
    },
  ],
};

export default extension;
