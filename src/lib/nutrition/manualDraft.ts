/** Short-lived handoff between photo review and manual entry. Keeps meal details out of URLs. */
type ManualDraft = { hint: string; photoUri?: string; meal: 'breakfast' | 'lunch' | 'dinner' | 'snack' };
let pending: ManualDraft | null = null;

export function setManualDraft(draft: ManualDraft): void { pending = draft; }
export function getManualDraft(): ManualDraft | null { return pending; }
export function clearManualDraft(): void { pending = null; }
