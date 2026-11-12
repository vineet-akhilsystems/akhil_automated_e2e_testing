// Field keys used by the case files (JSON / Excel columns) mapped to where they live on the page.
// Labels are the visible labels on demo (without the trailing "*"); column is the backend
// columnName (name attribute of the input, or of react-select's hidden input).
export type FieldKind = 'text' | 'select' | 'date' | 'datetime' | 'textarea' | 'checkbox';

export interface FieldDef {
  card: string;
  label: string;
  kind: FieldKind;
  column?: string;
}

export const FIELDS: Record<string, FieldDef> = {
  // Basic Information
  title: { card: 'Basic Information', label: 'Title', kind: 'select', column: 'Title' },
  first_name: { card: 'Basic Information', label: 'First Name', kind: 'text', column: 'first_name' },
  middle_name: { card: 'Basic Information', label: 'Middle Name', kind: 'text', column: 'middle_name' },
  last_name: { card: 'Basic Information', label: 'Last Name', kind: 'text', column: 'last_name' },
  gender: { card: 'Basic Information', label: 'Gender', kind: 'select', column: 'gender' },
  dob: { card: 'Basic Information', label: 'DOB', kind: 'date' },
  age: { card: 'Basic Information', label: 'Age', kind: 'text', column: 'age' },
  legal_guardian: { card: 'Basic Information', label: 'Legal Guardian', kind: 'text', column: 'legal_guardian' },
  marital_status: { card: 'Basic Information', label: 'Marital Status', kind: 'select', column: 'marital_status' },
  mobile: { card: 'Basic Information', label: 'Mobile No', kind: 'text', column: 'patient_phone' },
  whatsapp: { card: 'Basic Information', label: 'WhatsApp Mobile', kind: 'text', column: 'whatsapp' },
  email: { card: 'Basic Information', label: 'Email ID', kind: 'text', column: 'email' },
  // New Born Registration only
  mother_uhid: { card: 'Basic Information', label: 'Mother UHID', kind: 'text', column: 'mother_uhid' },
  mother_name: { card: 'Basic Information', label: "Mother's Name", kind: 'text' },
  father_name: { card: 'Basic Information', label: "Father's name", kind: 'text' },
  delivery_type: { card: 'Basic Information', label: 'Delivery Type', kind: 'select', column: 'delivery_type' },
  delivery_date: { card: 'Basic Information', label: 'Delivery Date', kind: 'datetime', column: 'delivery_date' },
  weight_kg: { card: 'Basic Information', label: 'Weight (Kg)', kind: 'text', column: 'weight_kg' },
  height_cm: { card: 'Basic Information', label: 'Height (cm)', kind: 'text', column: 'height_cm' },
  dependants: { card: 'Basic Information', label: 'Dependants', kind: 'select', column: 'dependants' },
  staff_details: { card: 'Basic Information', label: 'Staff Details', kind: 'text', column: 'searchQuick' },

  // Address Details (current address tab)
  mark_permanent: { card: 'Address Details', label: 'Mark current address as permanent', kind: 'checkbox' },
  country: { card: 'Address Details', label: 'Country', kind: 'select', column: 'Country' },
  pin_code: { card: 'Address Details', label: 'Pin Code', kind: 'text', column: 'pin_code' },
  state: { card: 'Address Details', label: 'State', kind: 'select', column: 'state' },
  district: { card: 'Address Details', label: 'District', kind: 'select', column: 'district' },
  city: { card: 'Address Details', label: 'City', kind: 'select', column: 'city' },
  area: { card: 'Address Details', label: 'Area', kind: 'select', column: 'area' },
  address: { card: 'Address Details', label: 'Address', kind: 'textarea', column: 'address_detail' },

  // Payer / Visit / Identity
  payer_type: { card: 'Payer Information', label: 'Payer Type', kind: 'select', column: 'payer_type' },
  payer: { card: 'Payer Information', label: 'Payer', kind: 'select' },
  sponsor: { card: 'Payer Information', label: 'Sponsor', kind: 'select' },
  department: { card: 'Visit Details', label: 'Department', kind: 'select', column: 'specialization' },
  consultant: { card: 'Visit Details', label: 'Consultant', kind: 'select', column: 'doctor' },
  referred_type: { card: 'Visit Details', label: 'Referred Type', kind: 'select', column: 'referred_type' },
  id_type: { card: 'Identity Information', label: 'Id Type', kind: 'select', column: 'identity_type' },
  id_number: { card: 'Identity Information', label: 'Id Number', kind: 'text', column: 'identity_no' },

  // Additional Details -> Emergency Info tab
  emergency_name: { card: 'Additional Details', label: 'Name', kind: 'text', column: 'Name' },
  emergency_relationship: { card: 'Additional Details', label: 'Relationship', kind: 'select', column: 'Relationship' },
  emergency_mobile: { card: 'Additional Details', label: 'Mobile Number', kind: 'text', column: 'mobile_number' },
  emergency_alternate: { card: 'Additional Details', label: 'Alternate Number', kind: 'text', column: 'alternate_number' },

  // Consent
  consent: { card: 'Consent', label: 'I hereby declare', kind: 'checkbox' },
};

// Address must be filled in this order: country -> pin (wait for lookup) -> state/district/city -> area -> text.
export const FILL_ORDER = [
  'title', 'first_name', 'middle_name', 'last_name', 'gender', 'dob', 'age', 'legal_guardian', 'marital_status',
  'mobile', 'whatsapp', 'email', 'mother_uhid', 'mother_name', 'father_name',
  'delivery_type', 'delivery_date', 'weight_kg', 'height_cm', 'dependants', 'staff_details',
  'country', 'pin_code', 'state', 'district', 'city', 'area', 'address', 'mark_permanent',
  'payer_type', 'payer', 'sponsor', 'department', 'consultant', 'referred_type', 'id_type', 'id_number',
  'emergency_name', 'emergency_relationship', 'emergency_mobile', 'emergency_alternate', 'consent',
];
