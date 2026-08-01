import { describe, expect, it } from 'vitest';
import type { BomShipmentPackingListSaveBodyType } from '@sp/api-contract';
import { nextPackageTransition, validatePackingSaveItems } from './bom-packing';

const body = (
  items: BomShipmentPackingListSaveBodyType['items'],
): BomShipmentPackingListSaveBodyType => ({ items });

describe('validatePackingSaveItems', () => {
  const expected = [
    { poItemId: 11, expectedQty: 5_000 },
    { poItemId: 12, expectedQty: 20 },
  ] as const;

  it('발주 수량을 여러 릴로 나눠도 합계가 같으면 허용한다', () => {
    expect(
      validatePackingSaveItems(
        expected,
        body([
          {
            poItemId: 11,
            packages: [
              { packageId: 101, quantity: 2_500, lotNo: 'A', dateCode: '2610' },
              { packageId: null, quantity: 2_500, lotNo: 'B', dateCode: '2611' },
            ],
          },
          {
            poItemId: 12,
            packages: [{ packageId: null, quantity: 20, lotNo: null, dateCode: null }],
          },
        ]),
      ),
    ).toBeNull();
  });

  it('행 누락·중복·다른 발주 품목을 거부한다', () => {
    expect(
      validatePackingSaveItems(
        expected,
        body([
          {
            poItemId: 11,
            packages: [{ packageId: null, quantity: 5_000, lotNo: null, dateCode: null }],
          },
        ]),
      ),
    ).toBe('PACKING_INVALID_ITEMS');
    expect(
      validatePackingSaveItems(
        expected,
        body([
          {
            poItemId: 11,
            packages: [{ packageId: null, quantity: 5_000, lotNo: null, dateCode: null }],
          },
          {
            poItemId: 11,
            packages: [{ packageId: null, quantity: 5_000, lotNo: null, dateCode: null }],
          },
        ]),
      ),
    ).toBe('PACKING_INVALID_ITEMS');
  });

  it('포장 합계가 발주 수량과 다르면 거부한다', () => {
    expect(
      validatePackingSaveItems(
        expected,
        body([
          {
            poItemId: 11,
            packages: [{ packageId: null, quantity: 4_999, lotNo: null, dateCode: null }],
          },
          {
            poItemId: 12,
            packages: [{ packageId: null, quantity: 20, lotNo: null, dateCode: null }],
          },
        ]),
      ),
    ).toBe('PACKING_INVALID_QUANTITY');
  });

  it('같은 기존 QR 포장을 두 행에 중복 제출하지 못한다', () => {
    expect(
      validatePackingSaveItems(
        expected,
        body([
          {
            poItemId: 11,
            packages: [{ packageId: 101, quantity: 5_000, lotNo: null, dateCode: null }],
          },
          {
            poItemId: 12,
            packages: [{ packageId: 101, quantity: 20, lotNo: null, dateCode: null }],
          },
        ]),
      ),
    ).toBe('PACKING_INVALID_PACKAGE');
  });
});

describe('nextPackageTransition', () => {
  it('입고 → 검수 → 보관 → 출고의 정상 전이를 허용한다', () => {
    expect(
      nextPackageTransition('prepared', { action: 'receive', location: null, note: null }),
    ).toEqual({ status: 'received', location: null });
    expect(
      nextPackageTransition('received', { action: 'inspect', location: null, note: null }),
    ).toEqual({ status: 'inspected', location: null });
    expect(
      nextPackageTransition('inspected', { action: 'store', location: 'A-03-02', note: null }),
    ).toEqual({ status: 'stored', location: 'A-03-02' });
    expect(
      nextPackageTransition('stored', { action: 'issue', location: null, note: null }),
    ).toEqual({ status: 'issued', location: null });
  });

  it('보관 위치 누락과 역방향·중복 액션을 거부한다', () => {
    expect(nextPackageTransition('received', { action: 'store', location: ' ', note: null })).toBe(
      'PACKAGE_LOCATION_REQUIRED',
    );
    expect(nextPackageTransition('prepared', { action: 'issue', location: null, note: null })).toBe(
      'PACKAGE_INVALID_ACTION',
    );
    expect(nextPackageTransition('issued', { action: 'receive', location: null, note: null })).toBe(
      'PACKAGE_INVALID_ACTION',
    );
    expect(nextPackageTransition('voided', { action: 'store', location: 'A-1', note: null })).toBe(
      'PACKAGE_INVALID_ACTION',
    );
  });
});
