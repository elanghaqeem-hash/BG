-- Implemented MVP schema. Use backend Store.initialize() on a NEW sandbox database.

CREATE TABLE anchors (
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id)
)

;

CREATE TABLE audit_log (
	sequence INTEGER NOT NULL,
	digest VARCHAR(64) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	UNIQUE (bank, sequence)
)

;

CREATE TABLE command_receipts (
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id)
)

;

CREATE TABLE mandates (
	principal VARCHAR(100) NOT NULL,
	broker VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id)
)

;

CREATE TABLE notifications (
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id)
)

;

CREATE TABLE offices (
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id)
)

;

CREATE TABLE outbox (
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id)
)

;

CREATE TABLE parties (
	kind VARCHAR(30) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id)
)

;

CREATE TABLE partners (
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id)
)

;

CREATE TABLE policies (
	version INTEGER NOT NULL,
	status VARCHAR(30) NOT NULL,
	maker VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	UNIQUE (bank, version)
)

;

CREATE TABLE users (
	username VARCHAR(120) NOT NULL,
	password TEXT NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	UNIQUE (username)
)

;

CREATE TABLE applications (
	principal VARCHAR(100) NOT NULL,
	obligee VARCHAR(100) NOT NULL,
	partner VARCHAR(100) NOT NULL,
	maker VARCHAR(100) NOT NULL,
	policy_id VARCHAR(100) NOT NULL,
	state VARCHAR(50) NOT NULL,
	version INTEGER NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	FOREIGN KEY(bank, principal) REFERENCES parties (bank, id),
	FOREIGN KEY(bank, obligee) REFERENCES parties (bank, id),
	FOREIGN KEY(bank, partner) REFERENCES partners (bank, id),
	FOREIGN KEY(bank, maker) REFERENCES users (bank, id),
	FOREIGN KEY(bank, policy_id) REFERENCES policies (bank, id)
)

;

CREATE TABLE sessions (
	user_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	FOREIGN KEY(bank, user_id) REFERENCES users (bank, id)
)

;

CREATE TABLE approvals (
	application_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	FOREIGN KEY(bank, application_id) REFERENCES applications (bank, id)
)

;
CREATE INDEX ix_approvals_application_id ON approvals (application_id);

CREATE TABLE claims (
	version INTEGER NOT NULL,
	state VARCHAR(60) NOT NULL,
	application_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	FOREIGN KEY(bank, application_id) REFERENCES applications (bank, id)
)

;
CREATE INDEX ix_claims_application_id ON claims (application_id);

CREATE TABLE distributions (
	status VARCHAR(30) NOT NULL,
	application_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	UNIQUE (bank, application_id),
	FOREIGN KEY(bank, application_id) REFERENCES applications (bank, id)
)

;
CREATE INDEX ix_distributions_application_id ON distributions (application_id);

CREATE TABLE documents (
	kind VARCHAR(60) NOT NULL,
	digest VARCHAR(64) NOT NULL,
	encrypted_bytes TEXT NOT NULL,
	application_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	FOREIGN KEY(bank, application_id) REFERENCES applications (bank, id)
)

;
CREATE INDEX ix_documents_application_id ON documents (application_id);

CREATE TABLE guarantees (
	token_hash VARCHAR(64) NOT NULL,
	number VARCHAR(100) NOT NULL,
	application_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	UNIQUE (bank, application_id),
	UNIQUE (bank, number),
	FOREIGN KEY(bank, application_id) REFERENCES applications (bank, id),
	UNIQUE (token_hash)
)

;
CREATE INDEX ix_guarantees_application_id ON guarantees (application_id);

CREATE TABLE journals (
	application_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	FOREIGN KEY(bank, application_id) REFERENCES applications (bank, id)
)

;
CREATE INDEX ix_journals_application_id ON journals (application_id);

CREATE TABLE tasks (
	due VARCHAR(40) NOT NULL,
	status VARCHAR(30) NOT NULL,
	application_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	FOREIGN KEY(bank, application_id) REFERENCES applications (bank, id)
)

;
CREATE INDEX ix_tasks_due ON tasks (due);
CREATE INDEX ix_tasks_application_id ON tasks (application_id);

CREATE TABLE litigation (
	claim_id VARCHAR(100) NOT NULL,
	state VARCHAR(40) NOT NULL,
	application_id VARCHAR(100) NOT NULL,
	bank VARCHAR(60) NOT NULL,
	id VARCHAR(100) NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (bank, id),
	UNIQUE (bank, claim_id),
	FOREIGN KEY(bank, claim_id) REFERENCES claims (bank, id)
)

;
CREATE INDEX ix_litigation_application_id ON litigation (application_id);
