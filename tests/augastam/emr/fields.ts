export interface FieldDef {
  card?: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'date' | 'datetime' | 'checkbox' | 'radio' | 'number';
  column?: string;
  required?: boolean;
  options?: string[];
}

export const FIELDS: Record<string, FieldDef> = {
  "email_id_user_name": {
    "label": "Email ID / User Name",
    "kind": "text",
    "card": "General",
    "required": true
  },
  "environment": {
    "label": "Environment",
    "kind": "select",
    "card": "General"
  },
  "import_source": {
    "label": "Import source",
    "kind": "select",
    "card": "General"
  },
  "import_destination": {
    "label": "Import destination",
    "kind": "select",
    "card": "General"
  },
  "transfer_mode": {
    "label": "Transfer mode",
    "kind": "radio",
    "card": "General"
  },
  "select_template": {
    "label": "Select Template",
    "kind": "select",
    "card": "General"
  },
  "template_name": {
    "label": "Template name",
    "kind": "text",
    "card": "General"
  },
  "non_selected_search": {
    "label": "Non Selected search",
    "kind": "text",
    "card": "General"
  },
  "selected_search": {
    "label": "Selected search",
    "kind": "text",
    "card": "General"
  },
  "workflow_selection": {
    "label": "Workflow selection",
    "kind": "checkbox",
    "card": "General"
  },
  "workflow_list_search": {
    "label": "Workflow list Search",
    "kind": "text",
    "card": "General"
  },
  "filter_by_provider": {
    "label": "Filter by Provider",
    "kind": "select",
    "card": "General"
  },
  "filter_by_category": {
    "label": "Filter by Category",
    "kind": "select",
    "card": "General"
  },
  "filter_by_group": {
    "label": "Filter by Group",
    "kind": "select",
    "card": "General"
  },
  "filter_by_type": {
    "label": "Filter by Type",
    "kind": "select",
    "card": "General"
  },
  "rows_per_page": {
    "label": "Rows per page",
    "kind": "select",
    "card": "General"
  },
  "status": {
    "label": "Status",
    "kind": "select",
    "card": "General"
  },
  "template_category_tab": {
    "label": "Template category tab",
    "kind": "text",
    "card": "General"
  },
  "search_templates": {
    "label": "Search Templates",
    "kind": "text",
    "card": "General"
  },
  "stage_select_role": {
    "label": "Stage Select Role",
    "kind": "select",
    "card": "General"
  },
  "new_process_name": {
    "label": "New Process Name",
    "kind": "text",
    "card": "General"
  },
  "process_select_role": {
    "label": "Process Select Role",
    "kind": "select",
    "card": "General"
  },
  "new_task_name": {
    "label": "New Task Name",
    "kind": "text",
    "card": "General"
  },
  "multiple_tab": {
    "label": "Multiple Tab",
    "kind": "checkbox",
    "card": "General"
  },
  "task_select_role": {
    "label": "Task Select Role",
    "kind": "select",
    "card": "General"
  },
  "general_examination_grid": {
    "label": "General Examination grid",
    "kind": "text",
    "card": "General"
  },
  "select_db_object": {
    "label": "Select DB Object",
    "kind": "select",
    "card": "General"
  },
  "search_by_key": {
    "label": "Search by key",
    "kind": "text",
    "card": "General"
  },
  "db_field_selection": {
    "label": "DB field selection",
    "kind": "checkbox",
    "card": "General"
  },
  "enter_new_name_edit_target_name": {
    "label": "Enter New Name (Edit Target Name)",
    "kind": "text",
    "card": "General"
  },
  "target_selector_edit_target_name": {
    "label": "Target selector (Edit Target Name)",
    "kind": "select",
    "card": "General"
  },
  "visit_list_from_date_to_date": {
    "label": "Visit list From Date / To Date",
    "kind": "date",
    "card": "General"
  },
  "search_patient_s_name_no_uhid": {
    "label": "Search Patient's Name/No./UHID",
    "kind": "text",
    "card": "General"
  },
  "visit_scope_op_ip_er": {
    "label": "Visit scope (OP / IP / ER)",
    "kind": "checkbox",
    "card": "General"
  },
  "count_chips": {
    "label": "Count chips",
    "kind": "text",
    "card": "General"
  },
  "visit_list_column_filters": {
    "label": "Visit list column filters",
    "kind": "select",
    "card": "General"
  },
  "visit_list_page_size": {
    "label": "Visit list page size",
    "kind": "select",
    "card": "General"
  },
  "enter_new_name_edit_target_name_2": {
    "label": "enter new name edit target name",
    "kind": "text",
    "card": "General"
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

export const FILL_ORDER: string[] = ["email_id_user_name","environment","import_source","import_destination","transfer_mode","select_template","template_name","non_selected_search","selected_search","workflow_selection","workflow_list_search","filter_by_provider","filter_by_category","filter_by_group","filter_by_type","rows_per_page","status","template_category_tab","search_templates","stage_select_role","new_process_name","process_select_role","new_task_name","multiple_tab","task_select_role","general_examination_grid","select_db_object","search_by_key","db_field_selection","enter_new_name_edit_target_name","target_selector_edit_target_name","visit_list_from_date_to_date","search_patient_s_name_no_uhid","visit_scope_op_ip_er","count_chips","visit_list_column_filters","visit_list_page_size","enter_new_name_edit_target_name_2","notes"];
