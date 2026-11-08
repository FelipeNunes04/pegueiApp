import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  BackArrowIcon,
  GalleryPlaceholderIcon,
  ManualClipIcon,
  PauseIcon,
  PlayIcon,
  SelectionCheckIcon,
  SettingsGearIcon,
  ShareIcon,
  TrashIcon,
} from '../components/icons';

type JsonNode = {
  type: string;
  props: Record<string, unknown>;
  children: JsonNode[] | null;
};

function collect(node: JsonNode | null, type: string, out: JsonNode[] = []): JsonNode[] {
  if (!node) return out;
  if (node.type === type) out.push(node);
  (node.children ?? []).forEach(child => {
    if (typeof child === 'object') collect(child, type, out);
  });
  return out;
}

async function renderIcon(element: React.ReactElement) {
  const result = await render(<View testID="wrap">{element}</View>);
  const tree = result.toJSON() as unknown as JsonNode;
  const svg = collect(tree, 'RNSVGSvgView')[0];
  return { tree, svg };
}

// react-native-svg serialises colours to ARGB ints; any non-null paint carries one.
function paints(tree: JsonNode): unknown[] {
  return ['RNSVGPath', 'RNSVGRect', 'RNSVGCircle']
    .flatMap(type => collect(tree, type))
    .flatMap(node => [node.props.fill, node.props.stroke])
    .filter(Boolean)
    .map(paint => (paint as { payload: unknown }).payload);
}

const RED = 0xffff0000;

describe('icons', () => {
  it.each([
    ['SettingsGearIcon', SettingsGearIcon, 20],
    ['GalleryPlaceholderIcon', GalleryPlaceholderIcon, 22],
    ['BackArrowIcon', BackArrowIcon, 22],
    ['TrashIcon', TrashIcon, 22],
    ['ShareIcon', ShareIcon, 22],
    ['PlayIcon', PlayIcon, 28],
    ['PauseIcon', PauseIcon, 28],
    ['SelectionCheckIcon', SelectionCheckIcon, 20],
    ['ManualClipIcon', ManualClipIcon, 14],
  ] as const)('%s renders at its default size and honours size/color overrides', async (_name, Icon, defaultSize) => {
    const defaults = await renderIcon(<Icon />);
    expect(defaults.svg.props.width).toBe(defaultSize);
    expect(defaults.svg.props.height).toBe(defaultSize);
    expect(paints(defaults.tree)).not.toContain(RED);

    const custom = await renderIcon(<Icon size={48} color="red" />);
    expect(custom.svg.props.width).toBe(48);
    expect(custom.svg.props.height).toBe(48);
    expect(paints(custom.tree)).toContain(RED);
  });

  it('SettingsGearIcon draws eight teeth around the ring', async () => {
    const { tree } = await renderIcon(<SettingsGearIcon />);

    expect(collect(tree, 'RNSVGRect')).toHaveLength(8);
  });

  it('SelectionCheckIcon only draws the check mark when selected', async () => {
    const unselected = await renderIcon(<SelectionCheckIcon />);
    const selected = await renderIcon(<SelectionCheckIcon selected />);

    expect(collect(unselected.tree, 'RNSVGPath')).toHaveLength(0);
    expect(collect(selected.tree, 'RNSVGPath')).toHaveLength(1);
  });

  it('SelectionCheckIcon fills the circle differently when selected vs. not', async () => {
    const unselected = await renderIcon(<SelectionCheckIcon />);
    const selected = await renderIcon(<SelectionCheckIcon selected />);

    const fillOf = (tree: JsonNode) => collect(tree, 'RNSVGCircle')[0].props.fill;
    expect(fillOf(selected.tree)).not.toEqual(fillOf(unselected.tree));
  });
});
