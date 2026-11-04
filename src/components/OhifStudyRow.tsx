import type { ReactNode } from 'react';

import { formatStudyDateTime, type Slide } from '@/lib/catalog';

/** A case's study in the OHIF tabs (DICOM PatientName and PatientID, date, time, modalities). */
export type DicomStudyRef = NonNullable<Slide['study']>;

const MODALITY_NAMES: Record<string, string> = {
  SM: 'slide images',
  ANN: 'AI annotations',
  CT: 'CT',
  PT: 'PET',
  MR: 'MRI',
  SEG: 'segmentations',
  RTSTRUCT: 'radiotherapy structures',
  SR: 'structured report',
};

/** The patient as OHIF's Patient column shows it (DICOM PatientName), without empty name parts. */
export function ohifPatient(study: DicomStudyRef): string {
  return study.patientName.replace(/^\^+|\^+$/g, '') || study.patientId;
}

/**
 * List row text for a case that is also in an OHIF tab: it leads with what that tab's study list shows (patient,
 * type, date), then the app's own title and description, so the case can be found in both.
 */
export function OhifStudyRowText({
  study,
  tab,
  title,
  description,
}: {
  study: DicomStudyRef;
  tab: string;
  title: ReactNode;
  description: ReactNode;
}) {
  const patient = ohifPatient(study);
  const types = study.modalities
    .split('\\')
    .map((m) => (MODALITY_NAMES[m] && MODALITY_NAMES[m] !== m ? `${m} ${MODALITY_NAMES[m]}` : m))
    .join(', ');
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline gap-2">
        <span className="truncate text-[13.5px] font-medium" title={`Patient, as in the ${tab} study list`}>
          {patient}
        </span>
        <span className="t-faint t-mono ml-auto shrink-0 text-[11px]" title={`Types of DICOM object in the study: ${types}`}>
          {study.modalities}
        </span>
      </span>
      <span className="t-muted block truncate text-[12.5px]">{title}</span>
      <span className="t-faint block truncate text-[11.5px]">{description}</span>
      <span className="t-faint block truncate text-[11.5px] tabular-nums" title="Study date and time in the DICOM study">
        {formatStudyDateTime(study.studyDate, study.studyTime)}
        {patient !== study.patientId && (
          <>
            {' · MRN '}
            <span className="t-mono">{study.patientId}</span>
          </>
        )}
      </span>
    </span>
  );
}
