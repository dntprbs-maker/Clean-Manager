import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { recordHubChange } from './hubChanges.js';

const handler = collection => onDocumentWritten({
  document: `companies/{companyId}/${collection}/{documentId}`,
  region: 'asia-northeast3', retry: true, maxInstances: 1, concurrency: 1,
}, event => recordHubChange(getFirestore(), { ...event.params, collection, deliveryId: event.id }));

export const hubEventChanged = handler('events');
export const hubCalendarChanged = handler('cals');
export const hubReportChanged = handler('reports');
