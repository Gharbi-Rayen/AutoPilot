const fs = require('fs');
let code = fs.readFileSync('src/features/executions/components/csv-join/dialog.tsx', 'utf8');

const regex = /const \[dismissedWarnings, setDismissedWarnings\] = useState<Set<number>>\([\s\S]*?const dismissWarning = \(index: number\) => \{[\s\S]*?setDismissedWarnings\(newDismissed\);\s+\};/;

const replacement = `const [dismissedWarnings, setDismissedWarnings] = useState<Set<number>>(
      new Set(),
    );

    const params = useParams<{ id: string }>(); // Wait, its usually id for workflow in editor! We checked! Let me just use [workflowId] from params as fallback, but wait! The editor folder was \`[workflowId]\`! Let's check \`src/app/(dashboard)/(editor)/workflows\` again.
    
    // Let me extract from next router useParams accurately.
    const leftVariable = form.watch("leftVariable");
    const rightVariable = form.watch("rightVariable");
    const joinType = form.watch("joinType");
    const keyPairs = form.watch("keyPairs");

    const [debouncedInput, setDebouncedInput] = useState<{
      leftVariable?: string;
      rightVariable?: string;
      joinType?: any;
      keyPairs?: { leftKey: string, rightKey: string }[];
    }>({});

    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedInput({
          leftVariable,
          rightVariable,
          joinType,
          keyPairs,
        });
      }, 500);
      return () => clearTimeout(handler);
    }, [leftVariable, rightVariable, joinType, keyPairs]);

    // Using params as Record<string, string> because it's dynamic
    const params = useParams() as Record<string, string>;
    const workflowId = params.workflowId || params.id;

    const { data: estimate, isFetching } = trpc.csvJoin.estimateOutput.useQuery(
      {
        workflowId: workflowId,
        ...debouncedInput,
      },
      {
        enabled: open && !!workflowId && !!debouncedInput.leftVariable && !!debouncedInput.rightVariable,
      }
    );

    const estimationWarnings: string[] = estimate?.warnings || [];
    const activeWarnings = estimationWarnings.filter(
      (_, i) => !dismissedWarnings.has(i),
    );

    const dismissWarning = (index: number) => {
      const newDismissed = new Set(dismissedWarnings);
      newDismissed.add(index);
      setDismissedWarnings(newDismissed);
    };`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/features/executions/components/csv-join/dialog.tsx', code);