-- Reference design only; NOT an applied MVP migration. See schema.sql for implemented store.
-- 0001_identity_party — UUID disuplai service, bukan nomor bisnis.
CREATE TABLE organization (
  id uuid PRIMARY KEY, kind text NOT NULL, display_name text NOT NULL
);
CREATE TABLE bank_tenant (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL UNIQUE REFERENCES organization(id),
  code text NOT NULL UNIQUE, environment text NOT NULL
);
CREATE TABLE app_user (
  id uuid PRIMARY KEY, oidc_issuer text NOT NULL, oidc_subject text NOT NULL,
  active boolean NOT NULL DEFAULT true, UNIQUE (oidc_issuer, oidc_subject)
);
CREATE TABLE bank_office (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, office_type text NOT NULL,
  active boolean NOT NULL DEFAULT true, PRIMARY KEY(bank_id,id), UNIQUE(bank_id,code)
);
CREATE TABLE membership (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, user_id uuid NOT NULL REFERENCES app_user(id),
  organization_id uuid NOT NULL REFERENCES organization(id), office_id uuid,
  role_code text NOT NULL, valid_from timestamptz NOT NULL, valid_to timestamptz,
  revoked_at timestamptz, PRIMARY KEY(bank_id,id),
  FOREIGN KEY(bank_id,office_id) REFERENCES bank_office(bank_id,id),
  CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE TABLE principal (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization(id), legal_name text NOT NULL,
  entity_type text NOT NULL, nib text, npwp_ciphertext bytea, kyb_status text NOT NULL,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,nib)
);
CREATE TABLE principal_pic (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, principal_id uuid NOT NULL,
  person_ciphertext bytea NOT NULL, authority_evidence_ref text NOT NULL,
  verified_at timestamptz, PRIMARY KEY(bank_id,id),
  FOREIGN KEY(bank_id,principal_id) REFERENCES principal(bank_id,id)
);
CREATE TABLE ubo (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, principal_id uuid NOT NULL,
  identity_ciphertext bytea NOT NULL, ownership_pct numeric(9,6), control_basis text,
  screening_status text NOT NULL, PRIMARY KEY(bank_id,id),
  FOREIGN KEY(bank_id,principal_id) REFERENCES principal(bank_id,id),
  CHECK(ownership_pct IS NULL OR ownership_pct BETWEEN 0 AND 100)
);
CREATE TABLE obligee (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization(id), legal_name text NOT NULL,
  category_code text NOT NULL, classification_evidence_ref text,
  classified_by uuid REFERENCES app_user(id), PRIMARY KEY(bank_id,id)
);
CREATE TABLE broker (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization(id), legal_name text NOT NULL,
  activity_scope text NOT NULL, license_reference text, license_valid_to date,
  license_verified_at timestamptz, whitelist_status text NOT NULL,
  conflict_status text NOT NULL, PRIMARY KEY(bank_id,id)
);
CREATE TABLE broker_mandate (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, principal_id uuid NOT NULL, broker_id uuid NOT NULL,
  scope_json jsonb NOT NULL, signed_doc_hash char(64) NOT NULL,
  valid_from timestamptz NOT NULL, valid_to timestamptz NOT NULL, revoked_at timestamptz,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,principal_id) REFERENCES principal(bank_id,id),
  FOREIGN KEY(bank_id,broker_id) REFERENCES broker(bank_id,id), CHECK(valid_to>valid_from)
);
CREATE TABLE penjamin (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization(id), legal_name text NOT NULL,
  institution_type text NOT NULL, permitted_products jsonb NOT NULL,
  license_reference text, operating_region jsonb NOT NULL, active boolean NOT NULL,
  PRIMARY KEY(bank_id,id)
);
CREATE TABLE project (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, principal_id uuid NOT NULL, obligee_id uuid NOT NULL,
  name text NOT NULL, contract_number text NOT NULL, project_value numeric(24,2),
  contract_doc_ref text, PRIMARY KEY(bank_id,id),
  FOREIGN KEY(bank_id,principal_id) REFERENCES principal(bank_id,id),
  FOREIGN KEY(bank_id,obligee_id) REFERENCES obligee(bank_id,id),
  CHECK(project_value IS NULL OR project_value>0)
);

-- 0002_policy
CREATE TABLE policy_version (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  code text NOT NULL, version integer NOT NULL CHECK(version>0), status text NOT NULL,
  effective_from date NOT NULL, effective_to date, rules_json jsonb NOT NULL,
  source_hash char(64) NOT NULL, maker_id uuid NOT NULL REFERENCES app_user(id),
  checker_id uuid REFERENCES app_user(id), dps_reference text,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,code,version),
  CHECK(effective_to IS NULL OR effective_to>effective_from),
  CHECK(checker_id IS NULL OR checker_id<>maker_id)
);
CREATE TABLE workflow_version (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  code text NOT NULL, version integer NOT NULL, status text NOT NULL,
  definition_json jsonb NOT NULL, definition_hash char(64) NOT NULL,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,code,version)
);
CREATE TABLE calendar_version (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  code text NOT NULL, version integer NOT NULL, timezone text NOT NULL,
  working_days jsonb NOT NULL, holidays jsonb NOT NULL, cutoff_local time NOT NULL,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,code,version)
);
CREATE TABLE penjamin_agreement (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, penjamin_id uuid NOT NULL,
  agreement_code text NOT NULL, version integer NOT NULL, status text NOT NULL,
  effective_from date NOT NULL, effective_to date NOT NULL,
  signed_doc_hash char(64) NOT NULL, approval_reference text,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,agreement_code,version),
  FOREIGN KEY(bank_id,penjamin_id) REFERENCES penjamin(bank_id,id),
  CHECK(effective_to>effective_from)
);
CREATE TABLE penjamin_parameter (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, agreement_id uuid NOT NULL,
  parameter_key text NOT NULL, bg_type text NOT NULL, parameter_value jsonb NOT NULL,
  source_clause text NOT NULL, is_assumption boolean NOT NULL DEFAULT true,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,agreement_id,parameter_key,bg_type),
  FOREIGN KEY(bank_id,agreement_id) REFERENCES penjamin_agreement(bank_id,id)
);
CREATE TABLE capacity_bucket (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, agreement_id uuid NOT NULL, principal_id uuid,
  scope_key text NOT NULL, currency char(3) NOT NULL, exposure_basis text NOT NULL,
  limit_amount numeric(24,2) NOT NULL CHECK(limit_amount>=0),
  reserved_amount numeric(24,2) NOT NULL DEFAULT 0 CHECK(reserved_amount>=0),
  outstanding_amount numeric(24,2) NOT NULL DEFAULT 0 CHECK(outstanding_amount>=0),
  lock_version bigint NOT NULL DEFAULT 0, PRIMARY KEY(bank_id,id),
  UNIQUE(bank_id,agreement_id,scope_key,currency),
  FOREIGN KEY(bank_id,agreement_id) REFERENCES penjamin_agreement(bank_id,id),
  FOREIGN KEY(bank_id,principal_id) REFERENCES principal(bank_id,id)
);

-- 0003_origination
CREATE TABLE bg_application (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_no text NOT NULL,
  principal_id uuid NOT NULL, project_id uuid NOT NULL, agreement_id uuid NOT NULL,
  processing_office_id uuid NOT NULL, issuing_office_id uuid NOT NULL, broker_mandate_id uuid,
  product_code text NOT NULL, bg_type text NOT NULL, amount numeric(24,2) NOT NULL CHECK(amount>0),
  currency char(3) NOT NULL, planned_issue_on date NOT NULL, expires_on date NOT NULL,
  custom_format boolean NOT NULL DEFAULT false, alternate_scheme_reason text,
  state text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  lock_version bigint NOT NULL DEFAULT 0, policy_version_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL, PRIMARY KEY(bank_id,id), UNIQUE(bank_id,application_no),
  FOREIGN KEY(bank_id,principal_id) REFERENCES principal(bank_id,id),
  FOREIGN KEY(bank_id,project_id) REFERENCES project(bank_id,id),
  FOREIGN KEY(bank_id,agreement_id) REFERENCES penjamin_agreement(bank_id,id),
  FOREIGN KEY(bank_id,processing_office_id) REFERENCES bank_office(bank_id,id),
  FOREIGN KEY(bank_id,issuing_office_id) REFERENCES bank_office(bank_id,id),
  FOREIGN KEY(bank_id,broker_mandate_id) REFERENCES broker_mandate(bank_id,id),
  FOREIGN KEY(bank_id,policy_version_id) REFERENCES policy_version(bank_id,id),
  FOREIGN KEY(bank_id,workflow_version_id) REFERENCES workflow_version(bank_id,id),
  CHECK(expires_on>=planned_issue_on)
);
CREATE TABLE application_revision (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), application_id uuid NOT NULL, revision integer NOT NULL,
  snapshot_json jsonb NOT NULL, snapshot_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL, PRIMARY KEY(bank_id,application_id,revision),
  FOREIGN KEY(bank_id,application_id) REFERENCES bg_application(bank_id,id)
);
CREATE TABLE document (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid,
  owner_org_id uuid NOT NULL REFERENCES organization(id), document_type text NOT NULL,
  object_key text NOT NULL, object_version text NOT NULL, sha256 char(64) NOT NULL,
  source_type text NOT NULL, primary_source_reference text, verification_status text NOT NULL,
  verified_by uuid REFERENCES app_user(id), verified_at timestamptz,
  malware_status text NOT NULL, original_status text NOT NULL,
  retention_until timestamptz NOT NULL, legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL, PRIMARY KEY(bank_id,id), UNIQUE(bank_id,object_key,object_version),
  FOREIGN KEY(bank_id,application_id) REFERENCES bg_application(bank_id,id)
);
CREATE TABLE resource_grant (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL,
  grantee_org_id uuid NOT NULL REFERENCES organization(id), allowed_fields jsonb NOT NULL,
  allowed_actions jsonb NOT NULL, valid_to timestamptz, revoked_at timestamptz,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,application_id) REFERENCES bg_application(bank_id,id)
);
CREATE TABLE kyb_check (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, principal_id uuid NOT NULL,
  check_type text NOT NULL, outcome text NOT NULL, source_doc_id uuid NOT NULL,
  checked_at timestamptz NOT NULL, checked_by uuid NOT NULL REFERENCES app_user(id),
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,principal_id) REFERENCES principal(bank_id,id),
  FOREIGN KEY(bank_id,source_doc_id) REFERENCES document(bank_id,id)
);
CREATE TABLE slik_result (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  pulled_at timestamptz NOT NULL, data_position_on date, worst_collectibility integer,
  outcome text NOT NULL, document_id uuid NOT NULL, verified_by uuid REFERENCES app_user(id),
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,application_id,revision)
    REFERENCES application_revision(bank_id,application_id,revision),
  FOREIGN KEY(bank_id,document_id) REFERENCES document(bank_id,id),
  CHECK(worst_collectibility IS NULL OR worst_collectibility BETWEEN 1 AND 5)
);
CREATE TABLE sp2kbg (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  agreement_id uuid NOT NULL, reference_no text NOT NULL, issuing_unit text NOT NULL,
  authority_reference text NOT NULL, valid_from date NOT NULL, valid_to date NOT NULL,
  approved_amount numeric(24,2) NOT NULL CHECK(approved_amount>0), currency char(3) NOT NULL,
  coverage_pct numeric(9,6) NOT NULL CHECK(coverage_pct>0 AND coverage_pct<=100),
  document_id uuid NOT NULL, status text NOT NULL,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,agreement_id,reference_no),
  FOREIGN KEY(bank_id,application_id,revision) REFERENCES application_revision(bank_id,application_id,revision),
  FOREIGN KEY(bank_id,agreement_id) REFERENCES penjamin_agreement(bank_id,id),
  FOREIGN KEY(bank_id,document_id) REFERENCES document(bank_id,id), CHECK(valid_to>=valid_from)
);
CREATE TABLE approval_step (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  step_code text NOT NULL, required_role text NOT NULL, matrix_snapshot jsonb NOT NULL,
  maker_id uuid NOT NULL REFERENCES app_user(id), checker_id uuid REFERENCES app_user(id),
  decision text NOT NULL, reason text, decided_at timestamptz, input_hash char(64) NOT NULL,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,application_id,revision,step_code),
  FOREIGN KEY(bank_id,application_id,revision) REFERENCES application_revision(bank_id,application_id,revision),
  CHECK(checker_id IS NULL OR checker_id<>maker_id)
);
CREATE TABLE format_approval (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  draft_doc_id uuid NOT NULL, approved_hash char(64) NOT NULL, evidence_doc_id uuid NOT NULL,
  penjamin_approver_ref text NOT NULL, status text NOT NULL, approved_at timestamptz,
  original_due_at timestamptz, original_received_at timestamptz,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,application_id,revision)
    REFERENCES application_revision(bank_id,application_id,revision),
  FOREIGN KEY(bank_id,draft_doc_id) REFERENCES document(bank_id,id),
  FOREIGN KEY(bank_id,evidence_doc_id) REFERENCES document(bank_id,id)
);
CREATE TABLE signature_envelope (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, document_id uuid NOT NULL,
  provider_code text NOT NULL, provider_reference text NOT NULL, document_hash char(64) NOT NULL,
  signers_snapshot jsonb NOT NULL, verification_result jsonb NOT NULL, status text NOT NULL,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,provider_code,provider_reference),
  FOREIGN KEY(bank_id,document_id) REFERENCES document(bank_id,id)
);
CREATE TABLE mkp (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  document_id uuid NOT NULL, signature_envelope_id uuid NOT NULL,
  interoffice_authorized boolean NOT NULL DEFAULT false, signed_at timestamptz,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,application_id,revision)
    REFERENCES application_revision(bank_id,application_id,revision),
  FOREIGN KEY(bank_id,document_id) REFERENCES document(bank_id,id),
  FOREIGN KEY(bank_id,signature_envelope_id) REFERENCES signature_envelope(bank_id,id)
);
CREATE TABLE akad (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  akad_type text NOT NULL, dps_reference text NOT NULL, document_id uuid NOT NULL,
  signature_envelope_id uuid NOT NULL, signed_at timestamptz,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,application_id,revision)
    REFERENCES application_revision(bank_id,application_id,revision),
  FOREIGN KEY(bank_id,document_id) REFERENCES document(bank_id,id),
  FOREIGN KEY(bank_id,signature_envelope_id) REFERENCES signature_envelope(bank_id,id)
);
CREATE TABLE interoffice_instruction (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  principal_request_doc_id uuid NOT NULL, mkp_id uuid NOT NULL, draft_doc_id uuid NOT NULL,
  ememo_doc_id uuid NOT NULL, recipient_snapshot jsonb NOT NULL,
  sent_at timestamptz, acknowledged_at timestamptz, status text NOT NULL,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,application_id,revision)
    REFERENCES application_revision(bank_id,application_id,revision),
  FOREIGN KEY(bank_id,principal_request_doc_id) REFERENCES document(bank_id,id),
  FOREIGN KEY(bank_id,mkp_id) REFERENCES mkp(bank_id,id),
  FOREIGN KEY(bank_id,draft_doc_id) REFERENCES document(bank_id,id),
  FOREIGN KEY(bank_id,ememo_doc_id) REFERENCES document(bank_id,id)
);
CREATE TABLE capacity_reservation (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, bucket_id uuid NOT NULL, application_id uuid NOT NULL,
  amount numeric(24,2) NOT NULL CHECK(amount>0), status text NOT NULL,
  expires_at timestamptz NOT NULL, PRIMARY KEY(bank_id,id),
  UNIQUE(bank_id,bucket_id,application_id),
  FOREIGN KEY(bank_id,bucket_id) REFERENCES capacity_bucket(bank_id,id),
  FOREIGN KEY(bank_id,application_id) REFERENCES bg_application(bank_id,id)
);

-- 0004_registry_finance
CREATE TABLE bank_guarantee (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL,
  bg_number text NOT NULL, amount numeric(24,2) NOT NULL CHECK(amount>0), currency char(3) NOT NULL,
  issued_at timestamptz NOT NULL, effective_on date NOT NULL, expires_on date NOT NULL,
  claim_deadline_at timestamptz NOT NULL, status text NOT NULL,
  processing_office_id uuid NOT NULL, issuing_office_id uuid NOT NULL,
  current_revision integer NOT NULL, PRIMARY KEY(bank_id,id),
  UNIQUE(bank_id,bg_number), UNIQUE(bank_id,application_id),
  FOREIGN KEY(bank_id,application_id) REFERENCES bg_application(bank_id,id),
  FOREIGN KEY(bank_id,processing_office_id) REFERENCES bank_office(bank_id,id),
  FOREIGN KEY(bank_id,issuing_office_id) REFERENCES bank_office(bank_id,id), CHECK(expires_on>=effective_on)
);
CREATE TABLE bg_version (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), bg_id uuid NOT NULL, revision integer NOT NULL, document_id uuid NOT NULL,
  signed_hash char(64) NOT NULL, data_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(bank_id,bg_id,revision), FOREIGN KEY(bank_id,bg_id) REFERENCES bank_guarantee(bank_id,id),
  FOREIGN KEY(bank_id,document_id) REFERENCES document(bank_id,id)
);
CREATE TABLE qr_credential (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, bg_id uuid NOT NULL, bg_revision integer NOT NULL,
  token_digest char(64) NOT NULL UNIQUE, issued_at timestamptz NOT NULL, revoked_at timestamptz,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,bg_id,bg_revision) REFERENCES bg_version(bank_id,bg_id,revision)
);
CREATE TABLE kontra_bg_certificate (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, bg_id uuid NOT NULL, sp2kbg_id uuid NOT NULL,
  agreement_id uuid NOT NULL, certificate_no text NOT NULL, document_id uuid NOT NULL,
  covered_amount numeric(24,2) NOT NULL CHECK(covered_amount>0), verified_at timestamptz,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,agreement_id,certificate_no),
  FOREIGN KEY(bank_id,bg_id) REFERENCES bank_guarantee(bank_id,id),
  FOREIGN KEY(bank_id,sp2kbg_id) REFERENCES sp2kbg(bank_id,id),
  FOREIGN KEY(bank_id,agreement_id) REFERENCES penjamin_agreement(bank_id,id),
  FOREIGN KEY(bank_id,document_id) REFERENCES document(bank_id,id)
);
CREATE TABLE amendment (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, bg_id uuid NOT NULL,
  kind text NOT NULL, from_revision integer NOT NULL, proposed_snapshot jsonb NOT NULL,
  penjamin_consent_doc_id uuid, status text NOT NULL, effective_at timestamptz,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,bg_id) REFERENCES bank_guarantee(bank_id,id),
  FOREIGN KEY(bank_id,penjamin_consent_doc_id) REFERENCES document(bank_id,id)
);
CREATE TABLE fee_schedule (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  component text NOT NULL, amount numeric(24,2) NOT NULL CHECK(amount>=0), currency char(3) NOT NULL,
  tariff_snapshot jsonb NOT NULL, dps_reference text, disclosed_at timestamptz,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,application_id,revision)
    REFERENCES application_revision(bank_id,application_id,revision)
);
CREATE TABLE fee_transaction (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, schedule_id uuid NOT NULL,
  provider_reference text NOT NULL, idempotency_key text NOT NULL, status text NOT NULL,
  amount numeric(24,2) NOT NULL CHECK(amount>0), currency char(3) NOT NULL,
  booked_at timestamptz, settled_at timestamptz,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,provider_reference), UNIQUE(bank_id,idempotency_key),
  FOREIGN KEY(bank_id,schedule_id) REFERENCES fee_schedule(bank_id,id)
);
CREATE TABLE ujrah_distribution (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, bg_id uuid NOT NULL,
  source_office_id uuid NOT NULL, target_office_id uuid NOT NULL,
  eligible_admin_income numeric(24,2) NOT NULL CHECK(eligible_admin_income>=0),
  cumulative_due_amount numeric(24,2) NOT NULL CHECK(cumulative_due_amount>=0),
  currency char(3) NOT NULL, policy_snapshot jsonb NOT NULL, booked_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL, settled_amount numeric(24,2) NOT NULL DEFAULT 0,
  settled_at timestamptz, posting_reference text, status text NOT NULL,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,bg_id),
  FOREIGN KEY(bank_id,bg_id) REFERENCES bank_guarantee(bank_id,id),
  FOREIGN KEY(bank_id,source_office_id) REFERENCES bank_office(bank_id,id),
  FOREIGN KEY(bank_id,target_office_id) REFERENCES bank_office(bank_id,id),
  CHECK(source_office_id<>target_office_id),
  CHECK(settled_amount>=0 AND settled_amount<=cumulative_due_amount)
);
CREATE TABLE journal_batch (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  business_event_ref text NOT NULL, idempotency_key text NOT NULL, status text NOT NULL,
  posted_at timestamptz, reversal_of uuid, PRIMARY KEY(bank_id,id),
  UNIQUE(bank_id,idempotency_key), FOREIGN KEY(bank_id,reversal_of) REFERENCES journal_batch(bank_id,id)
);
CREATE TABLE journal_line (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, batch_id uuid NOT NULL,
  account_code text NOT NULL, office_id uuid NOT NULL, currency char(3) NOT NULL,
  debit numeric(24,2) NOT NULL DEFAULT 0, credit numeric(24,2) NOT NULL DEFAULT 0,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,batch_id) REFERENCES journal_batch(bank_id,id),
  FOREIGN KEY(bank_id,office_id) REFERENCES bank_office(bank_id,id),
  CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0))
);

-- 0005_claims
CREATE TABLE claim (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, bg_id uuid NOT NULL,
  claimant_org_id uuid NOT NULL REFERENCES organization(id), reference_no text NOT NULL,
  amount numeric(24,2) NOT NULL CHECK(amount>0), currency char(3) NOT NULL,
  received_at timestamptz NOT NULL, document_id uuid NOT NULL, state text NOT NULL,
  bank_payment_reference text, bank_paid_at timestamptz, lock_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,bg_id,reference_no),
  FOREIGN KEY(bank_id,bg_id) REFERENCES bank_guarantee(bank_id,id),
  FOREIGN KEY(bank_id,document_id) REFERENCES document(bank_id,id)
);
CREATE TABLE claim_report (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, claim_id uuid NOT NULL, calendar_version_id uuid NOT NULL,
  report_due_at timestamptz NOT NULL, reported_at timestamptz,
  recipient_snapshot jsonb NOT NULL, evidence_doc_id uuid, completeness_status text NOT NULL,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,claim_id),
  FOREIGN KEY(bank_id,claim_id) REFERENCES claim(bank_id,id),
  FOREIGN KEY(bank_id,calendar_version_id) REFERENCES calendar_version(bank_id,id),
  FOREIGN KEY(bank_id,evidence_doc_id) REFERENCES document(bank_id,id)
);
CREATE TABLE kontra_claim (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, claim_id uuid NOT NULL, agreement_id uuid NOT NULL,
  assigned_role text NOT NULL, assigned_office_id uuid NOT NULL,
  amount numeric(24,2) NOT NULL CHECK(amount>0), currency char(3) NOT NULL,
  state text NOT NULL, submission_due_at timestamptz NOT NULL, submitted_at timestamptz,
  acknowledged_at timestamptz, complete_at timestamptz, payment_due_at timestamptz,
  decision_doc_id uuid, paid_amount numeric(24,2) NOT NULL DEFAULT 0,
  paid_at timestamptz, payment_reference text, lock_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(bank_id,id), FOREIGN KEY(bank_id,claim_id) REFERENCES claim(bank_id,id),
  FOREIGN KEY(bank_id,agreement_id) REFERENCES penjamin_agreement(bank_id,id),
  FOREIGN KEY(bank_id,assigned_office_id) REFERENCES bank_office(bank_id,id),
  FOREIGN KEY(bank_id,decision_doc_id) REFERENCES document(bank_id,id), CHECK(paid_amount>=0)
);
CREATE TABLE litigation_case (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, claim_id uuid NOT NULL, kontra_claim_id uuid,
  trigger_event_ref text NOT NULL, reason_code text NOT NULL, opened_at timestamptz NOT NULL,
  owner_user_id uuid REFERENCES app_user(id), state text NOT NULL,
  resolution_code text, resolution_doc_id uuid, closed_at timestamptz,
  PRIMARY KEY(bank_id,id), UNIQUE(bank_id,trigger_event_ref),
  FOREIGN KEY(bank_id,claim_id) REFERENCES claim(bank_id,id),
  FOREIGN KEY(bank_id,kontra_claim_id) REFERENCES kontra_claim(bank_id,id),
  FOREIGN KEY(bank_id,resolution_doc_id) REFERENCES document(bank_id,id)
);
CREATE TABLE recovery (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, claim_id uuid NOT NULL, kontra_claim_id uuid,
  principal_id uuid NOT NULL, rights_holder_org_id uuid NOT NULL REFERENCES organization(id),
  rights_basis_doc_id uuid NOT NULL, rights_amount numeric(24,2) NOT NULL CHECK(rights_amount>0),
  recovered_amount numeric(24,2) NOT NULL DEFAULT 0, currency char(3) NOT NULL,
  state text NOT NULL, PRIMARY KEY(bank_id,id),
  FOREIGN KEY(bank_id,claim_id) REFERENCES claim(bank_id,id),
  FOREIGN KEY(bank_id,kontra_claim_id) REFERENCES kontra_claim(bank_id,id),
  FOREIGN KEY(bank_id,principal_id) REFERENCES principal(bank_id,id),
  FOREIGN KEY(bank_id,rights_basis_doc_id) REFERENCES document(bank_id,id),
  CHECK(recovered_amount>=0 AND recovered_amount<=rights_amount)
);

-- 0006_operations_audit
CREATE TABLE rule_evaluation (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL, revision integer NOT NULL,
  policy_version_id uuid NOT NULL, br_code text NOT NULL, command_name text NOT NULL,
  input_hash char(64) NOT NULL, outcome text NOT NULL, reasons_json jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL, PRIMARY KEY(bank_id,id),
  FOREIGN KEY(bank_id,application_id,revision) REFERENCES application_revision(bank_id,application_id,revision),
  FOREIGN KEY(bank_id,policy_version_id) REFERENCES policy_version(bank_id,id)
);
CREATE TABLE state_event (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL,
  aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, aggregate_version bigint NOT NULL,
  from_state text NOT NULL, to_state text NOT NULL, command_name text NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_user(id), reason text NOT NULL,
  evidence_refs jsonb NOT NULL, workflow_version_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL, PRIMARY KEY(bank_id,id),
  UNIQUE(bank_id,aggregate_type,aggregate_id,aggregate_version),
  FOREIGN KEY(bank_id,application_id) REFERENCES bg_application(bank_id,id),
  FOREIGN KEY(bank_id,workflow_version_id) REFERENCES workflow_version(bank_id,id)
);
CREATE TABLE sla_task (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL, application_id uuid NOT NULL,
  related_event_id uuid NOT NULL, sla_code text NOT NULL, calendar_version_id uuid NOT NULL,
  owner_role text NOT NULL, due_at timestamptz NOT NULL, completed_at timestamptz,
  escalated_at timestamptz, status text NOT NULL, PRIMARY KEY(bank_id,id),
  UNIQUE(bank_id,related_event_id,sla_code),
  FOREIGN KEY(bank_id,application_id) REFERENCES bg_application(bank_id,id),
  FOREIGN KEY(bank_id,related_event_id) REFERENCES state_event(bank_id,id),
  FOREIGN KEY(bank_id,calendar_version_id) REFERENCES calendar_version(bank_id,id)
);
CREATE TABLE notification (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  event_reference text NOT NULL, recipient_org_id uuid NOT NULL REFERENCES organization(id),
  channel text NOT NULL, payload_reference text NOT NULL, status text NOT NULL,
  delivered_at timestamptz, PRIMARY KEY(bank_id,id),
  UNIQUE(bank_id,event_reference,recipient_org_id,channel)
);
CREATE TABLE outbox_event (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), id uuid NOT NULL,
  event_type text NOT NULL, aggregate_id uuid NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL, dispatched_at timestamptz, PRIMARY KEY(bank_id,id)
);
CREATE TABLE inbox_receipt (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), provider_code text NOT NULL,
  provider_event_id text NOT NULL, payload_hash char(64) NOT NULL,
  received_at timestamptz NOT NULL, processed_at timestamptz,
  PRIMARY KEY(bank_id,provider_code,provider_event_id)
);
CREATE TABLE command_receipt (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), idempotency_key text NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_user(id), command_name text NOT NULL,
  payload_hash char(64) NOT NULL, result_reference text, created_at timestamptz NOT NULL,
  PRIMARY KEY(bank_id,idempotency_key)
);
CREATE TABLE audit_log (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), sequence_no bigint NOT NULL,
  event_id uuid NOT NULL, actor_ref text NOT NULL, event_type text NOT NULL,
  canonical_payload jsonb NOT NULL, previous_hash char(64) NOT NULL,
  event_hash char(64) NOT NULL, occurred_at timestamptz NOT NULL,
  PRIMARY KEY(bank_id,sequence_no), UNIQUE(bank_id,event_id)
);
CREATE TABLE audit_anchor (
  bank_id uuid NOT NULL REFERENCES bank_tenant(id), sequence_no bigint NOT NULL,
  chain_hash char(64) NOT NULL, signature_reference text NOT NULL,
  external_object_reference text NOT NULL, anchored_at timestamptz NOT NULL,
  PRIMARY KEY(bank_id,sequence_no),
  FOREIGN KEY(bank_id,sequence_no) REFERENCES audit_log(bank_id,sequence_no)
);

-- Index contoh sesuai pola akses; semua child FK juga diberi index pada migrasi final.
CREATE INDEX ix_application_queue ON bg_application(bank_id,processing_office_id,state,created_at);
CREATE INDEX ix_application_principal ON bg_application(bank_id,principal_id,state);
CREATE INDEX ix_document_application ON document(bank_id,application_id,document_type);
CREATE INDEX ix_slik_recent ON slik_result(bank_id,application_id,pulled_at DESC);
CREATE INDEX ix_bg_expiry ON bank_guarantee(bank_id,status,expires_on);
CREATE INDEX ix_claim_aging ON claim(bank_id,state,received_at);
CREATE INDEX ix_kontra_deadline ON kontra_claim(bank_id,state,submission_due_at);
CREATE INDEX ix_sla_pending ON sla_task(bank_id,due_at) WHERE completed_at IS NULL;
CREATE INDEX ix_outbox_pending ON outbox_event(bank_id,created_at) WHERE dispatched_at IS NULL;
CREATE INDEX ix_audit_time ON audit_log(bank_id,occurred_at);