# Registration page discovery

Captured 2026-10-29T07:25:05.408Z from the live demo (read-only).

## New Registration

| Card | Field | Req | Kind | Column | Default | Options |
|---|---|---|---|---|---|---|
| Basic Information | UHID |  | text | uhr_id |  |  |
| Basic Information | Title | * | select | Title | Mr. | 5: Mr., None, Mrs., Ms., Baby Of |
| Basic Information | First Name | * | text | first_name |  |  |
| Basic Information | Middle Name |  | text | middle_name |  |  |
| Basic Information | Last Name | * | text | last_name |  |  |
| Basic Information | Gender | * | select | gender | Male | 5: Male, None, Female, Transgender, Other |
| Basic Information | DOB | * | date | sabyaDate |  |  |
| Basic Information | Age |  | text | age |  |  |
| Basic Information | Legal Guardian |  | text | legal_guardian |  |  |
| Basic Information | Marital Status |  | select | marital_status |  | 7: None, Married, Single, Divorced, Widow, Widower, Other |
| Basic Information | Mobile No | * | tel | patient_phone |  |  |
| Basic Information | WhatsApp Mobile |  | number | whatsapp |  |  |
| Basic Information | Email ID |  | text | email |  |  |
| Address Details | Country | * | select | Country | India | 129: India, None, Australia, Singapore, Sri Lanka, Dubai, INDIA, AFGANISTAN, AFGHANI, AIZAWL, ALBANIA, ALGERIA, … |
| Address Details | Pin Code | * | text | pin_code |  |  |
| Address Details | State | * | select | state | State | 37: ANDAMAN & NICOBAR ISLANDS, ANDHRA PRADESH, ARUNACHAL PRADESH, ASSAM, BIHAR, CHATTISGARH, DADRA & NAGAR HAVELI, DAMAN & DIU, DELHI, GOA, GUJARAT, HARYANA, … |
| Address Details | District |  | select | district | District | No options |
| Address Details | City |  | select | city | City | No options |
| Address Details | Area |  | select | area | Area | No options |
| Address Details | Address | * | textarea | address_detail |  |  |
| Payer Information | Payer Type | * | select | payer_type | Self-Paid | 3: Self-Paid, Corporate, Insurance |
| Payer Information | Payer | * | select (disabled) |  | Cash |  |
| Payer Information | Sponsor | * | select (disabled) |  | Cash |  |
| Visit Details | Department |  | select | specialization | Select | 88: Cardiology, Dental, ENT, Gynecology, Oncology, Ophthalmology, Orthopaedic, Paediatric, Pulmonary, Radiology And Imaging, Surgery, Radiology, … |
| Visit Details | Consultant |  | select | doctor | Select | 300: Govind Kumar, Suchitra Biswas, Kunal Thakur, Sneha Khurana, Sanket Mohanty, Saroj Mishra, Sanghamitra Pani, Manohar Buxi, Vikas Jain, Test B A, D Vaishali Taralekar, Anamika, … |
| Visit Details | Referred Type |  | select | referred_type | Self | 6: Self, None, Camp, External Provider, Facility, Internal Provider |
| Identity Information | Id Type | * | select | identity_type | Localite | 3: Localite, None, Foreigner |
| Identity Information | Id Number |  | text | identity_no |  |  |
| Additional Details | Name |  | text | Name |  |  |
| Additional Details | Relationship |  | select | Relationship |  | 11: None, Son, Father, Self, Mother, Wife, Husband, Brother, Sister, Uncle, Aunt |
| Additional Details | Mobile Number |  | text | mobile_number |  |  |
| Additional Details | Alternate Number |  | text | alternate_number |  |  |

## New Born Registration

| Card | Field | Req | Kind | Column | Default | Options |
|---|---|---|---|---|---|---|
| Basic Information | UHID |  | text | uhr_id |  |  |
| Basic Information | Mother UHID | * | text | mother_uhid |  |  |
| Basic Information | Title | * | select | Title | Mr. | 5: Mr., None, Mrs., Ms., Baby Of |
| Basic Information | First Name | * | text | first_name |  |  |
| Basic Information | Middle Name |  | text | middle_name |  |  |
| Basic Information | Last Name | * | text | last_name |  |  |
| Basic Information | Gender | * | select | gender | Male | 5: Male, None, Female, Transgender, Other |
| Basic Information | DOB | * | date | sabyaDate |  |  |
| Basic Information | Age |  | text | age |  |  |
| Basic Information | Mother's Name |  | text | mothers_name |  |  |
| Basic Information | Father's name |  | text | fathers_name |  |  |
| Basic Information | Legal Guardian |  | text | legal_guardian |  |  |
| Basic Information | Delivery Type |  | select | delivery_type |  | 8: None, Elective LSCS, Emergency LSCS, Forceps, Instrumental, LSCS, Normal, Vacuum |
| Basic Information | Delivery Date |  | datetime-local | delivery_date |  |  |
| Basic Information | Weight (Kg) |  | number | weight_kg |  |  |
| Basic Information | Height (cm) |  | number | height_cm |  |  |
| Basic Information | Marital Status |  | select | marital_status |  | 7: None, Married, Single, Divorced, Widow, Widower, Other |
| Basic Information | Mobile No | * | tel | patient_phone |  |  |
| Basic Information | WhatsApp Mobile |  | number | whatsapp |  |  |
| Basic Information | Email ID |  | text | email |  |  |
| Address Details | Country | * | select | Country | India | 129: India, None, Australia, Singapore, Sri Lanka, Dubai, INDIA, AFGANISTAN, AFGHANI, AIZAWL, ALBANIA, ALGERIA, … |
| Address Details | Pin Code | * | text | pin_code |  |  |
| Address Details | State | * | select | state | State | 37: ANDAMAN & NICOBAR ISLANDS, ANDHRA PRADESH, ARUNACHAL PRADESH, ASSAM, BIHAR, CHATTISGARH, DADRA & NAGAR HAVELI, DAMAN & DIU, DELHI, GOA, GUJARAT, HARYANA, … |
| Address Details | District |  | select | district | District | No options |
| Address Details | City |  | select | city | City | No options |
| Address Details | Area |  | select | area | Area | No options |
| Address Details | Address | * | textarea | address_detail |  |  |
| Payer Information | Payer Type | * | select | payer_type | Self-Paid | 3: Self-Paid, Corporate, Insurance |
| Payer Information | Payer | * | select (disabled) |  | Cash |  |
| Payer Information | Sponsor | * | select (disabled) |  | Cash |  |
| Visit Details | Department |  | select | specialization | Select | 88: Cardiology, Dental, ENT, Gynecology, Oncology, Ophthalmology, Orthopaedic, Paediatric, Pulmonary, Radiology And Imaging, Surgery, Radiology, … |
| Visit Details | Consultant |  | select | doctor | Select | 300: Govind Kumar, Suchitra Biswas, Kunal Thakur, Sneha Khurana, Sanket Mohanty, Saroj Mishra, Sanghamitra Pani, Manohar Buxi, Vikas Jain, Test B A, D Vaishali Taralekar, Anamika, … |
| Visit Details | Referred Type |  | select | referred_type | Self | 6: Self, None, Camp, External Provider, Facility, Internal Provider |
| Identity Information | Id Type | * | select | identity_type | Localite | 3: Localite, None, Foreigner |
| Identity Information | Id Number |  | text | identity_no |  |  |
| Additional Details | Name |  | text | Name |  |  |
| Additional Details | Relationship |  | select | Relationship |  | 11: None, Son, Father, Self, Mother, Wife, Husband, Brother, Sister, Uncle, Aunt |
| Additional Details | Mobile Number |  | text | mobile_number |  |  |
| Additional Details | Alternate Number |  | text | alternate_number |  |  |

## International Registration

| Card | Field | Req | Kind | Column | Default | Options |
|---|---|---|---|---|---|---|
| Basic Information | UHID |  | text | uhr_id |  |  |
| Basic Information | Title | * | select | Title | Mr. | 5: Mr., None, Mrs., Ms., Baby Of |
| Basic Information | First Name | * | text | first_name |  |  |
| Basic Information | Middle Name |  | text | middle_name |  |  |
| Basic Information | Last Name | * | text | last_name |  |  |
| Basic Information | Gender | * | select | gender | Male | 5: Male, None, Female, Transgender, Other |
| Basic Information | DOB | * | date | sabyaDate |  |  |
| Basic Information | Age |  | text | age |  |  |
| Basic Information | Legal Guardian |  | text | legal_guardian |  |  |
| Basic Information | Marital Status |  | select | marital_status |  | 7: None, Married, Single, Divorced, Widow, Widower, Other |
| Basic Information | Mobile No | * | tel | patient_phone |  |  |
| Basic Information | WhatsApp Mobile |  | number | whatsapp |  |  |
| Basic Information | Email ID |  | text | email |  |  |
| Address Details | Country | * | select | Country | India | 129: India, None, Australia, Singapore, Sri Lanka, Dubai, INDIA, AFGANISTAN, AFGHANI, AIZAWL, ALBANIA, ALGERIA, … |
| Address Details | Pin Code | * | text | pin_code |  |  |
| Address Details | State | * | select | state | State | 37: ANDAMAN & NICOBAR ISLANDS, ANDHRA PRADESH, ARUNACHAL PRADESH, ASSAM, BIHAR, CHATTISGARH, DADRA & NAGAR HAVELI, DAMAN & DIU, DELHI, GOA, GUJARAT, HARYANA, … |
| Address Details | District |  | select | district | District | No options |
| Address Details | City |  | select | city | City | No options |
| Address Details | Area |  | select | area | Area | No options |
| Address Details | Address | * | textarea | address_detail |  |  |
| Payer Information | Payer Type | * | select | payer_type | Self-Paid | 3: Self-Paid, Corporate, Insurance |
| Payer Information | Payer | * | select (disabled) |  | Cash |  |
| Payer Information | Sponsor | * | select (disabled) |  | Cash |  |
| Visit Details | Department |  | select | specialization | Select | 88: Cardiology, Dental, ENT, Gynecology, Oncology, Ophthalmology, Orthopaedic, Paediatric, Pulmonary, Radiology And Imaging, Surgery, Radiology, … |
| Visit Details | Consultant |  | select | doctor | Select | 300: Govind Kumar, Suchitra Biswas, Kunal Thakur, Sneha Khurana, Sanket Mohanty, Saroj Mishra, Sanghamitra Pani, Manohar Buxi, Vikas Jain, Test B A, D Vaishali Taralekar, Anamika, … |
| Visit Details | Referred Type |  | select | referred_type | Self | 6: Self, None, Camp, External Provider, Facility, Internal Provider |
| Identity Information | Id Type | * | select | identity_type | Localite | 3: Localite, None, Foreigner |
| Identity Information | Id Number |  | text | identity_no |  |  |
| Additional Details | Name |  | text | Name |  |  |
| Additional Details | Relationship |  | select | Relationship |  | 11: None, Son, Father, Self, Mother, Wife, Husband, Brother, Sister, Uncle, Aunt |
| Additional Details | Mobile Number |  | text | mobile_number |  |  |
| Additional Details | Alternate Number |  | text | alternate_number |  |  |

## Outside Registration

| Card | Field | Req | Kind | Column | Default | Options |
|---|---|---|---|---|---|---|
| Basic Information | UHID |  | text | uhr_id |  |  |
| Basic Information | Title | * | select | Title | Mr. | 5: Mr., None, Mrs., Ms., Baby Of |
| Basic Information | First Name | * | text | first_name |  |  |
| Basic Information | Middle Name |  | text | middle_name |  |  |
| Basic Information | Last Name | * | text | last_name |  |  |
| Basic Information | Gender | * | select | gender | Male | 5: Male, None, Female, Transgender, Other |
| Basic Information | DOB | * | date | sabyaDate |  |  |
| Basic Information | Age |  | text | age |  |  |
| Basic Information | Legal Guardian |  | text | legal_guardian |  |  |
| Basic Information | Marital Status |  | select | marital_status |  | 7: None, Married, Single, Divorced, Widow, Widower, Other |
| Basic Information | Mobile No | * | tel | patient_phone |  |  |
| Basic Information | WhatsApp Mobile |  | number | whatsapp |  |  |
| Basic Information | Email ID |  | text | email |  |  |
| Address Details | Country | * | select | Country | India | 129: India, None, Australia, Singapore, Sri Lanka, Dubai, INDIA, AFGANISTAN, AFGHANI, AIZAWL, ALBANIA, ALGERIA, … |
| Address Details | Pin Code | * | text | pin_code |  |  |
| Address Details | State | * | select | state | State | 37: ANDAMAN & NICOBAR ISLANDS, ANDHRA PRADESH, ARUNACHAL PRADESH, ASSAM, BIHAR, CHATTISGARH, DADRA & NAGAR HAVELI, DAMAN & DIU, DELHI, GOA, GUJARAT, HARYANA, … |
| Address Details | District |  | select | district | District | No options |
| Address Details | City |  | select | city | City | No options |
| Address Details | Area |  | select | area | Area | No options |
| Address Details | Address | * | textarea | address_detail |  |  |
| Payer Information | Payer Type | * | select | payer_type | Self-Paid | 3: Self-Paid, Corporate, Insurance |
| Payer Information | Payer | * | select (disabled) |  | Cash |  |
| Payer Information | Sponsor | * | select (disabled) |  | Cash |  |
| Visit Details | Department |  | select | specialization | Select | 88: Cardiology, Dental, ENT, Gynecology, Oncology, Ophthalmology, Orthopaedic, Paediatric, Pulmonary, Radiology And Imaging, Surgery, Radiology, … |
| Visit Details | Consultant |  | select | doctor | Select | 300: Govind Kumar, Suchitra Biswas, Kunal Thakur, Sneha Khurana, Sanket Mohanty, Saroj Mishra, Sanghamitra Pani, Manohar Buxi, Vikas Jain, Test B A, D Vaishali Taralekar, Anamika, … |
| Visit Details | Referred Type |  | select | referred_type | Self | 6: Self, None, Camp, External Provider, Facility, Internal Provider |
| Identity Information | Id Type | * | select | identity_type | Localite | 3: Localite, None, Foreigner |
| Identity Information | Id Number |  | text | identity_no |  |  |
| Additional Details | Name |  | text | Name |  |  |
| Additional Details | Relationship |  | select | Relationship |  | 11: None, Son, Father, Self, Mother, Wife, Husband, Brother, Sister, Uncle, Aunt |
| Additional Details | Mobile Number |  | text | mobile_number |  |  |
| Additional Details | Alternate Number |  | text | alternate_number |  |  |

## Staff Registration

| Card | Field | Req | Kind | Column | Default | Options |
|---|---|---|---|---|---|---|
| Basic Information | UHID |  | text | uhr_id |  |  |
| Basic Information | Dependants |  | select | dependants |  | 7: None, Self, Father, Mother, Son, Grandfather, Grandmother |
| Basic Information | Staff Details | * | text | searchQuick |  |  |
| Basic Information | Title | * | select | Title | Mr. | 5: Mr., None, Mrs., Ms., Baby Of |
| Basic Information | First Name | * | text | first_name |  |  |
| Basic Information | Middle Name |  | text | middle_name |  |  |
| Basic Information | Last Name | * | text | last_name |  |  |
| Basic Information | Gender | * | select | gender | Male | 5: Male, None, Female, Transgender, Other |
| Basic Information | DOB | * | date | sabyaDate |  |  |
| Basic Information | Age |  | text | age |  |  |
| Basic Information | Legal Guardian |  | text | legal_guardian |  |  |
| Basic Information | Marital Status |  | select | marital_status |  | 7: None, Married, Single, Divorced, Widow, Widower, Other |
| Basic Information | Mobile No | * | tel | patient_phone |  |  |
| Basic Information | WhatsApp Mobile |  | number | whatsapp |  |  |
| Basic Information | Email ID |  | text | email |  |  |
| Address Details | Country | * | select | Country | India | 129: India, None, Australia, Singapore, Sri Lanka, Dubai, INDIA, AFGANISTAN, AFGHANI, AIZAWL, ALBANIA, ALGERIA, … |
| Address Details | Pin Code | * | text | pin_code |  |  |
| Address Details | State | * | select | state | State | 37: ANDAMAN & NICOBAR ISLANDS, ANDHRA PRADESH, ARUNACHAL PRADESH, ASSAM, BIHAR, CHATTISGARH, DADRA & NAGAR HAVELI, DAMAN & DIU, DELHI, GOA, GUJARAT, HARYANA, … |
| Address Details | District |  | select | district | District | No options |
| Address Details | City |  | select | city | City | No options |
| Address Details | Area |  | select | area | Area | No options |
| Address Details | Address | * | textarea | address_detail |  |  |
| Payer Information | Payer Type | * | select | payer_type | Corporate | 3: Corporate, Self-Paid, Insurance |
| Payer Information | Payer | * | select (disabled) |  | Cash |  |
| Payer Information | Sponsor | * | select (disabled) |  | Cash |  |
| Payer Information | Corporate |  | select | corporate | Select | No options |
| Visit Details | Department |  | select | specialization | Select | 88: Cardiology, Dental, ENT, Gynecology, Oncology, Ophthalmology, Orthopaedic, Paediatric, Pulmonary, Radiology And Imaging, Surgery, Radiology, … |
| Visit Details | Consultant |  | select | doctor | Select | 300: Govind Kumar, Suchitra Biswas, Kunal Thakur, Sneha Khurana, Sanket Mohanty, Saroj Mishra, Sanghamitra Pani, Manohar Buxi, Vikas Jain, Test B A, D Vaishali Taralekar, Anamika, … |
| Visit Details | Referred Type |  | select | referred_type | Self | 6: Self, None, Camp, External Provider, Facility, Internal Provider |
| Identity Information | Id Type | * | select | identity_type | Localite | 3: Localite, None, Foreigner |
| Identity Information | Id Number |  | text | identity_no |  |  |
| Additional Details | Name |  | text | Name |  |  |
| Additional Details | Relationship |  | select | Relationship |  | 11: None, Son, Father, Self, Mother, Wife, Husband, Brother, Sister, Uncle, Aunt |
| Additional Details | Mobile Number |  | text | mobile_number |  |  |
| Additional Details | Alternate Number |  | text | alternate_number |  |  |

## Diagnostic Registration

| Card | Field | Req | Kind | Column | Default | Options |
|---|---|---|---|---|---|---|
| Basic Information | UHID |  | text | uhr_id |  |  |
| Basic Information | Title | * | select | Title | Mr. | 5: Mr., None, Mrs., Ms., Baby Of |
| Basic Information | First Name | * | text | first_name |  |  |
| Basic Information | Middle Name |  | text | middle_name |  |  |
| Basic Information | Last Name | * | text | last_name |  |  |
| Basic Information | Gender | * | select | gender | Male | 5: Male, None, Female, Transgender, Other |
| Basic Information | DOB | * | date | sabyaDate |  |  |
| Basic Information | Age |  | text | age |  |  |
| Basic Information | Legal Guardian |  | text | legal_guardian |  |  |
| Basic Information | Marital Status |  | select | marital_status |  | 7: None, Married, Single, Divorced, Widow, Widower, Other |
| Basic Information | Mobile No | * | tel | patient_phone |  |  |
| Basic Information | WhatsApp Mobile |  | number | whatsapp |  |  |
| Basic Information | Email ID |  | text | email |  |  |
| Address Details | Country | * | select | Country | India | 129: India, None, Australia, Singapore, Sri Lanka, Dubai, INDIA, AFGANISTAN, AFGHANI, AIZAWL, ALBANIA, ALGERIA, … |
| Address Details | Pin Code | * | text | pin_code |  |  |
| Address Details | State | * | select | state | State | 37: ANDAMAN & NICOBAR ISLANDS, ANDHRA PRADESH, ARUNACHAL PRADESH, ASSAM, BIHAR, CHATTISGARH, DADRA & NAGAR HAVELI, DAMAN & DIU, DELHI, GOA, GUJARAT, HARYANA, … |
| Address Details | District |  | select | district | District | No options |
| Address Details | City |  | select | city | City | No options |
| Address Details | Area |  | select | area | Area | No options |
| Address Details | Address | * | textarea | address_detail |  |  |
| Payer Information | Payer Type | * | select | payer_type | Self-Paid | 3: Self-Paid, Corporate, Insurance |
| Payer Information | Payer | * | select (disabled) |  | Cash |  |
| Payer Information | Sponsor | * | select (disabled) |  | Cash |  |
| Visit Details | Department |  | select | specialization | Select | 88: Cardiology, Dental, ENT, Gynecology, Oncology, Ophthalmology, Orthopaedic, Paediatric, Pulmonary, Radiology And Imaging, Surgery, Radiology, … |
| Visit Details | Consultant |  | select | doctor | Select | 300: Govind Kumar, Suchitra Biswas, Kunal Thakur, Sneha Khurana, Sanket Mohanty, Saroj Mishra, Sanghamitra Pani, Manohar Buxi, Vikas Jain, Test B A, D Vaishali Taralekar, Anamika, … |
| Visit Details | Referred Type |  | select | referred_type | Self | 6: Self, None, Camp, External Provider, Facility, Internal Provider |
| Identity Information | Id Type | * | select | identity_type | Localite | 3: Localite, None, Foreigner |
| Identity Information | Id Number |  | text | identity_no |  |  |
| Additional Details | Name |  | text | Name |  |  |
| Additional Details | Relationship |  | select | Relationship |  | 11: None, Son, Father, Self, Mother, Wife, Husband, Brother, Sister, Uncle, Aunt |
| Additional Details | Mobile Number |  | text | mobile_number |  |  |
| Additional Details | Alternate Number |  | text | alternate_number |  |  |
