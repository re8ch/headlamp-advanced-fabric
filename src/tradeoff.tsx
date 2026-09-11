import { SectionBox, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { completeSamples, TriangleSample as Sample } from './contract';

export type ObservationClient = (path: string) => Promise<any>;
type Subject = { kind: string; name: string; observedAt?: string; state: string };
type Relationship = { id: string; vertexLabel?: string; vertices: string[]; hypothesis?: string };
function useRequest(client: ObservationClient, path: string) {
  const [state, setState] = React.useState<{ data?: any; error?: string }>({});
  React.useEffect(() => {
    let active = true;
    setState({});
    client(path)
      .then(data => active && setState({ data }))
      .catch(error => active && setState({ error: String(error) }));
    return () => {
      active = false;
    };
  }, [client, path]);
  return state;
}

const POSITIONS = [
  { x: 60, y: 10 },
  { x: 12, y: 92 },
  { x: 108, y: 92 },
];
const CENTER = { x: 60, y: 64.67 };

function RelationshipTriangle({
  relationship,
  samples,
}: {
  relationship: Relationship;
  samples: Sample[];
}) {
  const theme = useTheme();
  const vertices = relationship.vertices;
  const colors = [
    theme.palette.info.main,
    theme.palette.secondary.main,
    theme.palette.warning.main,
    theme.palette.success.main,
    theme.palette.error.main,
    theme.palette.primary.light,
    theme.palette.primary.dark,
  ];
  const complete = completeSamples(vertices, samples);
  const points = (sample: Sample) =>
    vertices
      .map((vertex, index) => {
        const radius = 0.12 + Number(sample.coordinates[vertex]) * 0.84;
        const target = POSITIONS[index];
        return `${CENTER.x + (target.x - CENTER.x) * radius},${
          CENTER.y + (target.y - CENTER.y) * radius
        }`;
      })
      .join(' ');
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(520px,1.3fr) minmax(320px,.7fr)' },
        gap: 3,
      }}
    >
      <svg
        viewBox="0 0 120 106"
        width="100%"
        height="520"
        style={{ maxHeight: 520, minHeight: 360 }}
        role="img"
        aria-label={`${vertices.join(' ')} relationship triangle`}
      >
        <polygon
          points="60,10 12,92 108,92"
          fill="none"
          stroke={theme.palette.text.primary}
          strokeOpacity=".55"
          strokeWidth="1.2"
        />
        {[0.25, 0.5, 0.75].map(radius => (
          <polygon
            key={radius}
            fill="none"
            stroke={theme.palette.divider}
            strokeWidth=".45"
            points={POSITIONS.map(
              target =>
                `${CENTER.x + (target.x - CENTER.x) * radius},${
                  CENTER.y + (target.y - CENTER.y) * radius
                }`
            ).join(' ')}
          />
        ))}
        {complete.map((sample, index) => (
          <polygon
            key={sample.time}
            points={points(sample)}
            fill={colors[index % colors.length]}
            fillOpacity=".035"
            stroke={colors[index % colors.length]}
            strokeWidth={index === complete.length - 1 ? '1.25' : '.8'}
            strokeLinejoin="round"
          />
        ))}
        {vertices.map((vertex, index) => (
          <g key={vertex}>
            <circle
              cx={POSITIONS[index].x}
              cy={POSITIONS[index].y}
              r="2.6"
              fill={theme.palette.primary.main}
            />
            <text
              x={POSITIONS[index].x}
              y={index === 0 ? 5 : 102}
              textAnchor={index === 1 ? 'start' : index === 2 ? 'end' : 'middle'}
              fontSize="6"
              fontWeight="700"
              fill={theme.palette.text.primary}
            >
              {vertex}
            </text>
          </g>
        ))}
      </svg>
      <Stack gap={1.5} justifyContent="center">
        <Typography variant="h5">{relationship.vertexLabel || vertices.join('–')}</Typography>
        <Typography color="text.secondary">
          {relationship.hypothesis || 'Observed structural relationship.'}
        </Typography>
        <Alert severity="info">
          Each coloured closed triangle is one producer-synchronized time slice. The UI renders
          supplied coordinates without calculating or replacing them.
        </Alert>
        {!complete.length && (
          <Alert severity="warning">
            No time slice has all three coordinates. Missing values remain unavailable and are not
            rendered as zero.
          </Alert>
        )}
        {complete.map((sample, index) => (
          <Stack key={sample.time} direction="row" alignItems="center" gap={1}>
            <Box sx={{ width: 18, borderTop: 3, borderColor: colors[index % colors.length] }} />
            <Typography variant="caption">
              {new Date(sample.time * 1000).toLocaleString()} ·{' '}
              {vertices
                .map(
                  vertex => `${vertex} ${(Number(sample.coordinates[vertex]) * 100).toFixed(1)}%`
                )
                .join(' · ')}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export default function TradeoffObservatory({
  client,
  capabilities,
}: {
  client: ObservationClient;
  capabilities: string[];
}) {
  const subjectsState = useRequest(client, '/api/v1/subjects');
  const relationshipsState = useRequest(client, '/api/v1/relationships');
  const subjects: Subject[] = subjectsState.data?.items || [];
  const relationships: Relationship[] = relationshipsState.data?.items || [];
  const [selectedSubject, setSelectedSubject] = React.useState('');
  const [selectedRelationship, setSelectedRelationship] = React.useState('');
  const subject = subjects.some(item => item.name === selectedSubject)
    ? selectedSubject
    : subjects[0]?.name || '';
  const relationshipId = relationships.some(item => item.id === selectedRelationship)
    ? selectedRelationship
    : relationships[0]?.id || '';
  const relationship = relationships.find(item => item.id === relationshipId);
  const end = Math.floor(Date.now() / 1000);
  const start = end - 86400;
  const seriesPath =
    relationshipId && subject
      ? `/api/v1/relationships/${encodeURIComponent(
          relationshipId
        )}/series?subject=${encodeURIComponent(subject)}&start=${start}&end=${end}&maxPoints=7`
      : '/api/v1/relationships';
  const seriesState = useRequest(client, seriesPath);
  const snapshotState = useRequest(
    client,
    subject ? `/api/v1/subjects/Node/${encodeURIComponent(subject)}/snapshot` : '/api/v1/subjects'
  );
  const errors = [
    subjectsState.error,
    relationshipsState.error,
    seriesState.error,
    snapshotState.error,
  ].filter(Boolean) as string[];
  const snapshot = snapshotState.data;
  const measurementRows = Object.entries(snapshot?.latent || {}).map(([name, value]: any) => ({
    name,
    state: value.state,
    available: (value.availableSymbols || []).join(', ') || '—',
    missing: (value.missingSymbols || []).join(', ') || '—',
  }));
  return (
    <Box>
      {errors.map(error => (
        <Alert severity="error" sx={{ my: 1 }} key={error}>
          {error}
        </Alert>
      ))}
      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} sx={{ my: 2 }}>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel id="subject">Node</InputLabel>
          <Select
            labelId="subject"
            label="Node"
            value={subject}
            onChange={event => setSelectedSubject(event.target.value)}
          >
            {subjects.map(item => (
              <MenuItem key={item.name} value={item.name}>
                {item.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 280 }}>
          <InputLabel id="relationship">Relationship</InputLabel>
          <Select
            labelId="relationship"
            label="Relationship"
            value={relationshipId}
            onChange={event => setSelectedRelationship(event.target.value)}
          >
            {relationships.map(item => (
              <MenuItem key={item.id} value={item.id}>
                {item.vertexLabel || item.vertices.join('–')}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {subjects.find(item => item.name === subject) && (
          <Chip
            label={subjects.find(item => item.name === subject)!.state}
            color={
              subjects.find(item => item.name === subject)!.state === 'Ready'
                ? 'success'
                : 'warning'
            }
          />
        )}
        <Chip variant="outlined" label={`API capabilities: ${capabilities.length}`} />
      </Stack>
      {!subjects.length && !subjectsState.error && (
        <Alert severity="warning">The Advanced Fabric API reports no observable subjects.</Alert>
      )}
      {!relationships.length && !relationshipsState.error && (
        <Alert severity="warning">
          The Advanced Fabric API reports no relationship definitions.
        </Alert>
      )}
      {relationship && (
        <SectionBox
          title={`${
            relationship.vertexLabel || relationship.vertices.join('–')
          } relationship triangle`}
        >
          <RelationshipTriangle
            relationship={relationship}
            samples={seriesState.data?.samples || []}
          />
        </SectionBox>
      )}
      {snapshot && (
        <SectionBox title={`${subject} structural evidence`}>
          <Table
            data={measurementRows}
            columns={
              [
                { header: 'Quantity', accessorKey: 'name' },
                { header: 'Evidence state', accessorKey: 'state' },
                { header: 'Available measurements', accessorKey: 'available' },
                { header: 'Missing measurements', accessorKey: 'missing' },
              ] as any
            }
          />
        </SectionBox>
      )}
    </Box>
  );
}
