export interface FieldDef {
  card?: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'date' | 'datetime' | 'checkbox' | 'radio' | 'number';
  column?: string;
  required?: boolean;
  options?: string[];
}

export const FIELDS: Record<string, FieldDef> = {
  "gender": {
    "label": "Gender",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "dob": {
    "label": "DOB",
    "kind": "date",
    "card": "General",
    "required": true
  },
  "mobile": {
    "label": "Mobile",
    "kind": "text",
    "card": "General",
    "required": true
  },
  "whatsapp_no": {
    "label": "Whatsapp No",
    "kind": "text",
    "card": "General",
    "required": true
  },
  "nationality": {
    "label": "Nationality",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "identity_type": {
    "label": "Identity Type",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "payer_type": {
    "label": "Payer Type",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "payer": {
    "label": "Payer",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "referral_type": {
    "label": "Referral Type",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "delivery_type": {
    "label": "Delivery Type",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "delivery_date": {
    "label": "Delivery Date",
    "kind": "date",
    "card": "General",
    "required": true
  },
  "weight_kg": {
    "label": "Weight (Kg)",
    "kind": "number",
    "card": "General",
    "required": true
  },
  "height_cm": {
    "label": "Height (cm)",
    "kind": "number",
    "card": "General",
    "required": true
  },
  "identity": {
    "label": "Identity #",
    "kind": "text",
    "card": "General",
    "required": true
  },
  "visa_no": {
    "label": "Visa No",
    "kind": "text",
    "card": "General",
    "required": true
  },
  "exp_date": {
    "label": "Exp Date",
    "kind": "date",
    "card": "General",
    "required": true
  },
  "emp": {
    "label": "Emp#",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "relation": {
    "label": "Relation",
    "kind": "select",
    "card": "General",
    "required": true
  },
  "record_id": {
    "label": "Record ID",
    "kind": "text",
    "card": "General"
  },
  "notes": {
    "label": "Notes",
    "kind": "textarea",
    "card": "General"
  },
  "search": {
    "label": "Search query",
    "kind": "text",
    "card": "Search"
  }
};

export const FILL_ORDER: string[] = ["gender","dob","mobile","whatsapp_no","nationality","identity_type","payer_type","payer","referral_type","delivery_type","delivery_date","weight_kg","height_cm","identity","visa_no","exp_date","emp","relation","notes"];
