"""Versioned declarative predicates. No eval or user-supplied executable expressions."""
from dataclasses import dataclass
from datetime import datetime, timedelta, time
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo


class DomainError(Exception):
    def __init__(self, code, detail, status=422):
        self.code, self.detail, self.status = code, detail, status
        super().__init__(detail)


def require(condition, code, detail, status=422):
    if not condition:
        raise DomainError(code, detail, status)


def money(value):
    try:
        d = Decimal(str(value))
        require(d.is_finite() and d >= 0 and d < Decimal("1e20"), "AMOUNT", "Nominal tidak valid")
        require(d == d.quantize(Decimal("0.01")), "AMOUNT", "Maksimal dua desimal")
        return d
    except (ValueError, ArithmeticError):
        raise DomainError("AMOUNT", "Nominal tidak valid")


def business_due(now, days, calendar):
    local = now.astimezone(ZoneInfo(calendar["timezone"]))
    cursor = local.date()
    remaining = days
    while remaining:
        cursor += timedelta(days=1)
        if cursor.weekday() in calendar["working_days"] and cursor.isoformat() not in calendar["holidays"]:
            remaining -= 1
    return datetime.combine(cursor, time.fromisoformat(calendar["cutoff"]), ZoneInfo(calendar["timezone"])).astimezone(ZoneInfo("UTC"))


def split_ujrah(admin_income, policy):
    r = policy["rules"]["BR-13"]
    return min(money(admin_income) * Decimal(r["rate"]), money(r["cap"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def committee(category, amount, policy):
    r = policy["rules"]["BR-04"]
    if category in r["exempt_categories"]:
        return None
    return r["lower_role"] if money(amount) <= money(r["threshold"]) else r["upper_role"]


def predicate(p, facts):
    op = p["op"]
    if op == "all":
        return all(predicate(x, facts) for x in p["items"])
    if op == "any":
        return any(predicate(x, facts) for x in p["items"])
    value = facts.get(p["field"])
    if op == "eq": return value == p["value"]
    if op == "in": return value in p["values"]
    if op == "truthy": return bool(value)
    raise DomainError("POLICY", f"Operator tidak didukung: {op}")


def evaluate(code, facts, policy):
    rule = policy["rules"].get(code)
    require(rule is not None, "POLICY", f"Rule {code} tidak tersedia")
    applicable = predicate(rule["when"], facts) if "when" in rule else True
    passed = not applicable or predicate(rule["assert"], facts)
    return {"rule": code, "applicable": applicable, "passed": passed, "message": rule["message"]}


def enforce(codes, facts, policy):
    results = [evaluate(code, facts, policy) for code in codes]
    errors = [r for r in results if not r["passed"]]
    require(not errors, errors[0]["rule"] if errors else "RULE", errors[0]["message"] if errors else "")
    return results
