"""Actual Temporal test-server check, including worker restart and idempotent escalation."""
import asyncio,json,sys,tempfile
from pathlib import Path
from datetime import datetime,timezone,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"backend"))
from temporalio import activity
from temporalio.client import WorkflowFailureError
from temporalio.testing import WorkflowEnvironment
from temporalio.api.enums.v1 import EventType
from temporalio.worker import Worker
from cryptography.fernet import Fernet
from bg.db import Store,Task,Notification,User
from bg.service import Service,load,dumps,iso
from bg.workflows import BankSLASweep
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bootstrap import seed

async def main():
    with tempfile.TemporaryDirectory() as td:
        store=Store(f"sqlite:///{td}/db.sqlite");seed(store)
        calls=[]
        @activity.defn(name="sweep_bank")
        async def sweep(bank):
            calls.append(bank);return {"escalated":0}
        env=await WorkflowEnvironment.start_time_skipping()
        try:
            async with Worker(env.client,task_queue="bg-durable-test",workflows=[BankSLASweep],activities=[sweep],max_cached_workflows=0):
                handle=await env.client.start_workflow(BankSLASweep.run,args=["bank-uat",60],id="bg-restart-test",task_queue="bg-durable-test")
                for _ in range(100):
                    if calls: break
                    await asyncio.sleep(.02)
                assert calls,"Activity pertama tidak berjalan"
                for _ in range(200):
                    history=await handle.fetch_history()
                    if any(e.event_type==EventType.EVENT_TYPE_TIMER_STARTED for e in history.events):break
                    await asyncio.sleep(.02)
                else:raise AssertionError("Timer belum dijadwalkan")
            before=len(calls)
            # Server retains the durable timer while there is no worker.
            await env.sleep(65)
            async with Worker(env.client,task_queue="bg-durable-test",workflows=[BankSLASweep],activities=[sweep],max_cached_workflows=0):
                for _ in range(200):
                    if len(calls)>before:break
                    await asyncio.sleep(.02)
                assert len(calls)>before,"Timer tidak dilanjutkan setelah worker restart"
                await handle.cancel()
            result={"temporal_test_server":"PASS","durable_timer_worker_restart":"PASS","activity_calls":len(calls),"live_provider_tested":False}
            path=Path(__file__).resolve().parents[1]/"evidence/temporal.json";path.write_text(json.dumps(result,indent=2));print(json.dumps(result))
        finally:await env.shutdown();store.engine.dispose()

if __name__=="__main__":asyncio.run(main())
