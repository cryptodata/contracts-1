import * as assert from 'assert';
import { Artifacts } from '../../util/artifacts';
import { crypto } from '../../util/crypto';
import { MultiSigWrapper } from '../../util/multi_sig_wrapper';
import { ContractInstance, TransactionDataParams } from '../../util/types';
import { testUtil } from '../../util/test_util';
import * as proxyJSON from '../../build/contracts/Proxy.json';
const { Proxy, MultiSigWalletWithTimeLockExceptRemoveAuthorizedAddress } = new Artifacts(artifacts);
const PROXY_ABI = (proxyJSON as any).abi;

contract('MultiSigWalletWithTimeLockExceptRemoveAuthorizedAddress', (accounts: string[]) => {
  const owners = [accounts[0], accounts[1]];
  const requiredApprovals = 2;
  const SECONDS_TIME_LOCKED = 1000000;

  // initialize fake addresses
  const authorizedAddress = `0x${crypto.solSHA3([accounts[0]]).slice(0, 20).toString('hex')}`;
  const unauthorizedAddress = `0x${crypto.solSHA3([accounts[1]]).slice(0, 20).toString('hex')}`;

  let proxy: ContractInstance;
  let multiSig: ContractInstance;
  let multiSigWrapper: MultiSigWrapper;

  let validDestination: string;

  beforeEach(async () => {
    const initialOwner = accounts[0];
    proxy = await Proxy.new({ from: initialOwner });
    await proxy.addAuthorizedAddress(authorizedAddress, { from: initialOwner });
    multiSig = await MultiSigWalletWithTimeLockExceptRemoveAuthorizedAddress.new(owners, requiredApprovals, SECONDS_TIME_LOCKED, proxy.address);
    await proxy.transferOwnership(multiSig.address, { from: initialOwner });
    multiSigWrapper = new MultiSigWrapper(multiSig);
    validDestination = proxy.address;
  });

  describe('bytes4FromBytes', () => {
    it('should return the first 4 bytes of a byte array of any size', async () => {
      const data = multiSigWrapper.encodeFnArgs('addAuthorizedAddress', PROXY_ABI, [owners[0]]);
      const first4Bytes = await multiSig.bytes4FromBytes(data);

      const expectedFirst4Bytes = data.slice(0, 10);
      assert.equal(first4Bytes.length, 10);
      assert.equal(first4Bytes, expectedFirst4Bytes);
    });
  });

  describe('executeRemoveAuthorizedAddress', () => {
    it('should throw without the required confirmations', async () => {
      const dataParams: TransactionDataParams = {
        name: 'removeAuthorizedAddress',
        abi: PROXY_ABI,
        args: [authorizedAddress],
      };
      const res = await multiSigWrapper.submitTransactionAsync(validDestination, owners[0], dataParams);
      const txId = res.logs[0].args.transactionId.toString();

      try {
        await multiSig.executeRemoveAuthorizedAddress(txId);
        throw new Error('executeRemoveAuthorizedAddress succeeded when it should have failed');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should throw if tx destination is not the proxy', async () => {
      const invalidProxy = await Proxy.new();
      const invalidDestination = invalidProxy.address;
      const dataParams: TransactionDataParams = {
        name: 'removeAuthorizedAddress',
        abi: PROXY_ABI,
        args: [authorizedAddress],
      };
      const res = await multiSigWrapper.submitTransactionAsync(invalidDestination, owners[0], dataParams);
      const txId = res.logs[0].args.transactionId.toString();
      await multiSig.confirmTransaction(txId, { from: owners[1] });
      const isConfirmed = await multiSig.isConfirmed.call(txId);
      assert.equal(isConfirmed, true);

      try {
        await multiSig.executeRemoveAuthorizedAddress(txId);
        throw new Error('executeRemoveAuthorizedAddress succeeded when it should have failed');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should throw if tx data is not for removeAuthorizedAddress', async () => {
      const dataParams: TransactionDataParams = {
        name: 'addAuthorizedAddress',
        abi: PROXY_ABI,
        args: [unauthorizedAddress],
      };
      const res = await multiSigWrapper.submitTransactionAsync(validDestination, owners[0], dataParams);
      const txId = res.logs[0].args.transactionId.toString();
      await multiSig.confirmTransaction(txId, { from: owners[1] });
      const isConfirmed = await multiSig.isConfirmed.call(txId);
      assert.equal(isConfirmed, true);

      try {
        await multiSig.executeRemoveAuthorizedAddress(txId);
        throw new Error('executeRemoveAuthorizedAddress succeeded when it should have failed');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should execute removeAuthorizedAddress for valid proxy if fully confirmed', async () => {
      const dataParams: TransactionDataParams = {
        name: 'removeAuthorizedAddress',
        abi: PROXY_ABI,
        args: [authorizedAddress],
      };
      const res = await multiSigWrapper.submitTransactionAsync(validDestination, owners[0], dataParams);
      const txId = res.logs[0].args.transactionId.toString();
      await multiSig.confirmTransaction(txId, { from: owners[1] });
      const isConfirmed = await multiSig.isConfirmed.call(txId);
      assert.equal(isConfirmed, true);
      await multiSig.executeRemoveAuthorizedAddress(txId);

      const isAuthorized = await proxy.authorized.call(authorizedAddress);
      assert.equal(isAuthorized, false);
    });

    it('should throw if already executed', async () => {
      const dataParams: TransactionDataParams = {
        name: 'removeAuthorizedAddress',
        abi: PROXY_ABI,
        args: [authorizedAddress],
      };
      const res = await multiSigWrapper.submitTransactionAsync(validDestination, owners[0], dataParams);
      const txId = res.logs[0].args.transactionId.toString();
      await multiSig.confirmTransaction(txId, { from: owners[1] });
      const isConfirmed = await multiSig.isConfirmed.call(txId);
      assert.equal(isConfirmed, true);
      await multiSig.executeRemoveAuthorizedAddress(txId);
      const tx = await multiSig.transactions.call(txId);
      const isExecuted = tx[3];
      assert.equal(isExecuted, true);

      try {
        await multiSig.executeRemoveAuthorizedAddress(txId);
        throw new Error('executeRemoveAuthorizedAddress succeeded when it should have failed');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });
  });
});
