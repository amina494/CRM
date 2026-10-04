export const CATEGORIES = {
  vvip: 'VVIP', vip: 'VIP', delegation: 'Delegation', media: 'Media', general: 'General', companion: 'Companion', staff: 'Staff / Security',
};
export const RSVP = { pending: 'Pending', attending: 'Attending', tentative: 'Tentative', declined: 'Declined' };
export const INVITE = { not_sent: 'Not sent', sent: 'Sent', opened: 'Opened', failed: 'Failed' };
export const GUEST_STATUS = {
  not_arrived: 'Not arrived', in_flight: 'In flight', landed: 'Landed', in_transit: 'In transit',
  at_hotel: 'At hotel', at_venue: 'At venue', out: 'Out', departed: 'Departed',
};
export const FLIGHT_STATUS = { scheduled: 'Scheduled', delayed: 'Delayed', departed: 'Departed', landed: 'Landed', cancelled: 'Cancelled' };
export const SERVICE = { tanfeethi: 'Tanfeethi (Executive)', general: 'General (Commercial)' };
export const TRANSFER_KIND = {
  airport_pickup: 'Airport pickup', airport_dropoff: 'Airport drop-off', to_venue: 'To venue', from_venue: 'From venue', custom: 'Other trip',
};
export const TRANSFER_STATUS = { scheduled: 'Scheduled', en_route: 'Driver en route', picked_up: 'Picked up', completed: 'Completed', cancelled: 'Cancelled' };
export const ACCOM_STATUS = { reserved: 'Reserved', checked_in: 'Checked in', checked_out: 'Checked out', cancelled: 'Cancelled' };
export const VEHICLE_TYPES = { sedan: 'Sedan', suv: 'SUV', van: 'Van', bus: 'Bus', limousine: 'Limousine', other: 'Other' };
export const VEHICLE_STATUS = { available: 'Available', in_use: 'In use', maintenance: 'Maintenance' };
export const DRIVER_STATUS = { available: 'Available', on_duty: 'On duty', off_duty: 'Off duty' };
export const ROLES = { admin: 'Admin', coordinator: 'Coordinator', liaison: 'Liaison / Host', viewer: 'Viewer (read-only)' };

// Badge tone for each status value.
export const TONE = {
  attending: 'green', declined: 'red', tentative: 'amber', pending: 'gray',
  not_sent: 'gray', sent: 'blue', opened: 'green', failed: 'red',
  not_arrived: 'gray', in_flight: 'blue', landed: 'teal', in_transit: 'amber', at_hotel: 'violet', at_venue: 'green', out: 'blue', departed: 'gray',
  scheduled: 'gray', delayed: 'red', cancelled: 'red', completed: 'green', en_route: 'amber', picked_up: 'blue',
  reserved: 'blue', checked_in: 'green', checked_out: 'gray',
  available: 'green', in_use: 'amber', maintenance: 'red', on_duty: 'amber', off_duty: 'gray',
  vvip: 'gold', vip: 'gold', delegation: 'violet', media: 'blue', general: 'gray', companion: 'teal', staff: 'gray',
  tanfeethi: 'gold', general_flight: 'gray',
};
