import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { CATEGORIES, RSVP } from '../constants.js';
import { Form, guestName, toOptions, useApi } from './ui.jsx';

/** Create or edit a guest, including host, seating and dedicated car/driver. */
export default function GuestForm({ guest, onSaved, onCancel, defaultLead }) {
  const { event, can } = useApp();
  // Only coordinators and liaisons on this event can host a guest.
  const members = useApi(`/events/${event.id}/members`).data;
  const users = members?.filter((m) => m.role !== 'viewer');
  // Liaisons do not see the seating plan, so they get no table picker.
  const tablesApi = useApi(can.overview ? `/events/${event.id}/tables` : null);
  const tables = can.overview ? tablesApi.data : [];
  const vehicles = useApi('/vehicles').data;
  const drivers = useApi('/drivers').data;
  const guests = useApi(`/events/${event.id}/guests`).data;

  if (!users || !tables || !vehicles || !drivers || !guests) return <div className="loading">Loading…</div>;

  const leads = guests.filter((g) => !g.party_lead_id && g.id !== guest?.id);
  // Who looks after a guest is set by coordinators; liaisons see it but cannot change it.
  const locked = can.liaison;
  const lockedHint = locked ? 'Set by a coordinator' : undefined;
  const initial = guest
    ? { ...guest }
    : { category: defaultLead ? 'companion' : 'general', language: 'en', plus_ones_allowed: 0, rsvp_status: 'pending', party_lead_id: defaultLead || '' };

  const fields = [
    { name: 'title', label: 'Title', placeholder: 'H.E., Dr., Mr.…' },
    { name: 'first_name', label: 'First name', required: true },
    { name: 'last_name', label: 'Last name' },
    { name: 'name_ar', label: 'Name in Arabic', dir: 'rtl' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Mobile / WhatsApp', placeholder: '+9665…', hint: 'International format' },
    { name: 'organization', label: 'Organisation' },
    { name: 'position', label: 'Position' },
    { name: 'nationality', label: 'Nationality' },
    { name: 'category', label: 'Category', type: 'select', options: CATEGORIES, required: true },
    { name: 'language', label: 'Invitation language', type: 'select', options: { en: 'English', ar: 'العربية' }, required: true },
    { name: 'plus_ones_allowed', label: 'Plus-ones allowed', type: 'number' },
    { name: 'party_lead_id', label: 'Accompanying (party lead)', type: 'select', options: toOptions(leads, guestName), empty: '— Principal guest —', disabled: locked, hint: lockedHint },
    { name: 'relationship', label: 'Relationship to lead', placeholder: 'Spouse, aide, security…' },
    { name: 'host_user_id', label: 'Assigned host / liaison', type: 'select', options: toOptions(users), empty: '— Unassigned —', disabled: locked, hint: lockedHint },
    { name: 'backup_host_user_id', label: 'Backup host', type: 'select', options: toOptions(users), empty: '— None —', disabled: locked, hint: locked ? '' : 'Covers when the host is away; sees this guest too' },
    { name: 'rsvp_status', label: 'RSVP', type: 'select', options: RSVP, required: true },
    can.overview && { name: 'table_id', label: 'Table', type: 'select', options: toOptions(tables, (t) => `${t.name}${t.zone ? ` (${t.zone})` : ''}`) },
    can.overview && { name: 'seat_number', label: 'Seat' },
    { name: 'vehicle_id', label: 'Dedicated car', type: 'select', options: toOptions(vehicles, (v) => `${v.plate} · ${v.make || ''} ${v.model || ''}`) },
    { name: 'driver_id', label: 'Dedicated driver', type: 'select', options: toOptions(drivers) },
    { name: 'dietary', label: 'Dietary / accessibility', span: 2 },
    { name: 'notes', label: 'Internal notes', type: 'textarea', span: 2, hint: 'Protocol notes, preferences – never shown to the guest' },
  ];

  async function submit(values) {
    if (guest) {
      await api.put(`/guests/${guest.id}`, values);
      onSaved(guest.id);
    } else {
      const { id } = await api.post(`/events/${event.id}/guests`, values);
      onSaved(id);
    }
  }

  return <Form initial={initial} fields={fields} onSubmit={submit} onCancel={onCancel} submitLabel={guest ? 'Save changes' : 'Add guest'} />;
}
