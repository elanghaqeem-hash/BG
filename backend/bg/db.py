"""Durable MVP store. PostgreSQL is canonical; SQLite is a local test option."""
from contextlib import contextmanager
from hashlib import sha256
from sqlalchemy import create_engine, String, Text, Integer, ForeignKeyConstraint, UniqueConstraint, event, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class Record(Base):
    __abstract__ = True
    bank: Mapped[str] = mapped_column(String(60), primary_key=True)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    data: Mapped[str] = mapped_column(Text, default="{}")


class User(Record):
    __tablename__ = "users"
    username: Mapped[str] = mapped_column(String(120), unique=True)
    password: Mapped[str] = mapped_column(Text)


class Session(Record):
    __tablename__ = "sessions"
    user_id: Mapped[str] = mapped_column(String(100))
    __table_args__ = (ForeignKeyConstraint(["bank", "user_id"], ["users.bank", "users.id"]),)


class Policy(Record):
    __tablename__ = "policies"
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30))
    maker: Mapped[str] = mapped_column(String(100))
    __table_args__ = (UniqueConstraint("bank", "version"),)


class Party(Record):
    __tablename__ = "parties"
    kind: Mapped[str] = mapped_column(String(30))


class Office(Record):
    __tablename__ = "offices"


class Partner(Record):
    __tablename__ = "partners"


class Mandate(Record):
    __tablename__ = "mandates"
    principal: Mapped[str] = mapped_column(String(100))
    broker: Mapped[str] = mapped_column(String(100))


class Application(Record):
    __tablename__ = "applications"
    principal: Mapped[str] = mapped_column(String(100))
    obligee: Mapped[str] = mapped_column(String(100))
    partner: Mapped[str] = mapped_column(String(100))
    maker: Mapped[str] = mapped_column(String(100))
    policy_id: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(50), default="DRAFT")
    version: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (
        ForeignKeyConstraint(["bank", "principal"], ["parties.bank", "parties.id"]),
        ForeignKeyConstraint(["bank", "obligee"], ["parties.bank", "parties.id"]),
        ForeignKeyConstraint(["bank", "partner"], ["partners.bank", "partners.id"]),
        ForeignKeyConstraint(["bank", "maker"], ["users.bank", "users.id"]),
        ForeignKeyConstraint(["bank", "policy_id"], ["policies.bank", "policies.id"]),
    )


class ApplicationRecord(Record):
    __abstract__ = True
    application_id: Mapped[str] = mapped_column(String(100), index=True)


class Document(ApplicationRecord):
    __tablename__ = "documents"
    __table_args__ = (ForeignKeyConstraint(["bank", "application_id"], ["applications.bank", "applications.id"]),)
    kind: Mapped[str] = mapped_column(String(60))
    digest: Mapped[str] = mapped_column(String(64))
    encrypted_bytes: Mapped[str] = mapped_column(Text)


class Approval(ApplicationRecord):
    __tablename__ = "approvals"
    __table_args__ = (ForeignKeyConstraint(["bank", "application_id"], ["applications.bank", "applications.id"]),)


class Guarantee(ApplicationRecord):
    __tablename__ = "guarantees"
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    number: Mapped[str] = mapped_column(String(100))
    __table_args__ = (
        UniqueConstraint("bank", "application_id"), UniqueConstraint("bank", "number"),
        ForeignKeyConstraint(["bank", "application_id"], ["applications.bank", "applications.id"]),
    )


class Claim(ApplicationRecord):
    __tablename__ = "claims"
    version: Mapped[int] = mapped_column(Integer, default=0)
    state: Mapped[str] = mapped_column(String(60))
    __table_args__ = (ForeignKeyConstraint(["bank", "application_id"], ["applications.bank", "applications.id"]),)


class Litigation(ApplicationRecord):
    __tablename__ = "litigation"
    claim_id: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(40))
    __table_args__ = (UniqueConstraint("bank", "claim_id"), ForeignKeyConstraint(["bank", "claim_id"], ["claims.bank", "claims.id"]),)


class Task(ApplicationRecord):
    __tablename__ = "tasks"
    due: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(30))
    __table_args__ = (ForeignKeyConstraint(["bank", "application_id"], ["applications.bank", "applications.id"]),)


class Journal(ApplicationRecord):
    __tablename__ = "journals"
    __table_args__ = (ForeignKeyConstraint(["bank", "application_id"], ["applications.bank", "applications.id"]),)


class Distribution(ApplicationRecord):
    __tablename__ = "distributions"
    status: Mapped[str] = mapped_column(String(30))
    __table_args__ = (UniqueConstraint("bank", "application_id"), ForeignKeyConstraint(["bank", "application_id"], ["applications.bank", "applications.id"]),)


class Receipt(Record):
    __tablename__ = "command_receipts"


class Audit(Record):
    __tablename__ = "audit_log"
    sequence: Mapped[int] = mapped_column(Integer)
    digest: Mapped[str] = mapped_column(String(64))
    __table_args__ = (UniqueConstraint("bank", "sequence"),)


class Outbox(Record):
    __tablename__ = "outbox"


class Notification(Record):
    __tablename__ = "notifications"


class Anchor(Record):
    __tablename__ = "anchors"


class Store:
    def __init__(self, url):
        self.sqlite = url.startswith("sqlite")
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30} if self.sqlite else {}, pool_pre_ping=True)
        if self.sqlite:
            @event.listens_for(self.engine, "connect")
            def configure(dbapi_connection, _):
                dbapi_connection.execute("PRAGMA foreign_keys=ON")
                dbapi_connection.execute("PRAGMA journal_mode=WAL")
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def initialize(self):
        Base.metadata.create_all(self.engine)
        if self.sqlite:
            with self.engine.begin() as c:
                for table in ("audit_log", "journals", "approvals"):
                    for op in ("UPDATE", "DELETE"):
                        c.exec_driver_sql(f"CREATE TRIGGER IF NOT EXISTS {table}_{op.lower()}_deny BEFORE {op} ON {table} BEGIN SELECT RAISE(ABORT, 'append only'); END")

    @contextmanager
    def transaction(self, bank=None):
        with self.sessions() as s:
            try:
                if self.sqlite:
                    s.connection().exec_driver_sql("BEGIN IMMEDIATE")
                elif bank:
                    # One bank lock serializes audit head, limit reservations and registry numbering.
                    key = int.from_bytes(sha256(bank.encode()).digest()[:8], "big", signed=True)
                    s.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
                    s.execute(text("SELECT set_config('app.bank_id', :bank, true)"), {"bank": bank})
                yield s
                s.commit()
            except Exception:
                s.rollback()
                raise
