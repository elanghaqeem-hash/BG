from datetime import timedelta
from temporalio import workflow


@workflow.defn
class BankSLASweep:
    @workflow.run
    async def run(self,bank:str,interval_seconds:int=60):
        for _ in range(300):
            await workflow.execute_activity("sweep_bank",bank,start_to_close_timeout=timedelta(seconds=45))
            await workflow.sleep(timedelta(seconds=interval_seconds))
        workflow.continue_as_new(args=[bank,interval_seconds])
