import { expect } from 'chai';
import { publicClient } from '../contract-helpers';

interface Event {
  contract: any;
  eventName: string;
}

interface EventAssertion extends Event {
  eventLength?: number;
  argNames?: string[];
  argValuesList?: any[][];
}

export async function assertEvent(tx: Promise<any>, eventAssertions: EventAssertion[], unemittedEvent?: Event) {
  const hash = await tx;
  await publicClient.waitForTransactionReceipt({ hash });

  if (unemittedEvent) {
    const events = await unemittedEvent.contract.getEvents[unemittedEvent.eventName]();
    expect(events.length).to.equal(0);
  }
  for (const assertion of eventAssertions) {
    const events = await assertion.contract.getEvents[assertion.eventName]();
    if (assertion.eventLength) {
      expect(events.length).to.equal(assertion.eventLength);
    }

    if (assertion.argNames && assertion.argValuesList) {
      for (let i = 0; i < events.length; i++) {
        for (let j = 0; j < assertion.argNames.length; j++) {
          expect(events[i].args[assertion.argNames[j]]).to.deep.equal(assertion.argValuesList[i][j]);
        }
      }
    }
  }
}

export async function assertPostTxEvent(eventAssertions: EventAssertion[], unemittedEvent?: Event) {
  if (unemittedEvent) {
    const events = await unemittedEvent.contract.getEvents[unemittedEvent.eventName]();
    expect(events.length).to.equal(0);
  }
  for (const assertion of eventAssertions) {
    const events = await assertion.contract.getEvents[assertion.eventName]();
    if (assertion.eventLength) {
      expect(events.length).to.equal(assertion.eventLength);
    }

    if (assertion.argNames && assertion.argValuesList) {
      for (let i = 0; i < events.length; i++) {
        for (let j = 0; j < assertion.argNames.length; j++) {
          expect(events[i].args[assertion.argNames[j]]).to.deep.equal(assertion.argValuesList[i][j]);
        }
      }
    }
  }
}
