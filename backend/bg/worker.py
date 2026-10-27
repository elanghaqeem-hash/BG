import asyncio,os
from concurrent.futures import ThreadPoolExecutor
from temporalio import activity
from temporalio.client import Client
from temporalio.worker import Worker
from temporalio.exceptions import WorkflowAlreadyStartedError
from cryptography.fernet import Fernet
from .db import Store,User,Outbox
from .service import Service,load,dumps,iso
from .workflows import BankSLASweep


@activity.defn
def sweep_bank(bank:str):
    if os.getenv("APP_ENV","development") not in {"development","test"}: raise RuntimeError("Worker MVP hanya sandbox")
    store=Store(os.environ["DATABASE_URL"])
    service=Service(store,Fernet(os.environ["BG_ENCRYPTION_KEY"].encode()))
    try:
        with store.transaction(bank) as s:
            user=service.get(s,User,bank,"worker"); actor={"id":user.id,"bank":bank,**load(user)}
            result=service.tick(s,actor)
            # Durable outbox development dispatcher. Live email/WA is deliberately not fabricated.
            for event in service.rows(s,Outbox,bank):
                d=load(event)
                if d["status"]=="PENDING": d.update(status="MOCK_DISPATCHED",dispatched_at=iso(service.clock()));event.data=dumps(d)
            return result
    finally: store.engine.dispose()


async def main():
    client=await Client.connect(os.getenv("TEMPORAL_ADDRESS","localhost:7233"))
    bank=os.getenv("BG_BANK","bank-uat")
    try: await client.start_workflow(BankSLASweep.run,args=[bank,60],id="bg-sla-"+bank,task_queue="bg-ecosystem")
    except WorkflowAlreadyStartedError: pass
    with ThreadPoolExecutor(max_workers=4) as pool:
        async with Worker(client,task_queue="bg-ecosystem",workflows=[BankSLASweep],activities=[sweep_bank],activity_executor=pool):
            await asyncio.Event().wait()

if __name__=="__main__": asyncio.run(main())
